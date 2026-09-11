import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  GenerateBatchScheduleInputSchema,
  isScheduleCurrent,
  type GenerateBatchScheduleInput,
  type GenerateBatchScheduleResult,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import {
  DEFAULT_MEMORY,
  DEFAULT_TIMEOUT_SECONDS,
  GEMINI_API_KEY,
  MAX_INSTANCES,
  REGION,
} from '../config';
import { internal, invalidArgument, notFound, parseInput, unavailable } from '../lib/errors';
import {
  acquireGenerationLock,
  consumeGenerationQuota,
  refundGenerationQuota,
  releaseGenerationLock,
  reportGenerationStep,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import { PlanNotFoundError, readPlanForEdit, readPlanRecipes } from '../lib/plan-writer';
import { readBatchSchedule, writeBatchSchedule } from '../lib/batch-schedule-writer';
import { GeminiUnavailableError } from '../gemini/client';
import {
  BatchScheduleGenerationError,
  generateBatchScheduleFromGemini,
} from '../gemini/generate-batch-schedule';

/**
 * Compose le déroulé entrelacé du dimanche, à la demande.
 *
 * Généré seulement si quelqu'un ouvre l'onglet, puis conservé : une génération
 * par batch, jamais une par consultation. Si un déroulé à jour existe déjà —
 * l'autre téléphone vient de le composer — il est rendu tel quel, sans rien
 * décompter. La vérification se fait **sous le verrou** : sans lui, deux
 * téléphones qui ouvrent l'onglet en même temps paieraient deux fois.
 */
export const generateBatchSchedule = onCall(
  {
    region: REGION,
    memory: DEFAULT_MEMORY,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxInstances: MAX_INSTANCES,
    secrets: [GEMINI_API_KEY],
  },
  async (request): Promise<GenerateBatchScheduleResult> => {
    logger.info('generateBatchSchedule appelée', { authentifie: Boolean(request.auth) });

    const uid = requireAuth(request);
    const input: GenerateBatchScheduleInput = parseInput(
      GenerateBatchScheduleInputSchema,
      request.data,
      'generateBatchSchedule',
    );

    await requireHouseholdMember(uid, input.householdId);

    const plan = await readPlanOrFail(input.householdId, input.weekId);
    if (plan.batchRecipeIds.length === 0) {
      throw invalidArgument('Cette semaine n’a pas de batch à organiser.');
    }

    await acquireGenerationLock(input.householdId, input.weekId, uid);
    try {
      const existing = await readBatchSchedule(input.householdId, input.weekId);
      if (existing && isScheduleCurrent(existing, plan)) {
        return { weekId: input.weekId, stepCount: existing.steps.length, generated: false };
      }
      return await composeSchedule(input, plan, uid);
    } finally {
      await releaseGenerationLock(input.householdId, input.weekId);
    }
  },
);

async function composeSchedule(
  input: GenerateBatchScheduleInput,
  plan: WeeklyPlan,
  uid: string,
): Promise<GenerateBatchScheduleResult> {
  await consumeGenerationQuota(input.householdId);

  const known = await readPlanRecipes(input.householdId, plan);
  const recipes = plan.batchRecipeIds
    .map((id) => known.get(id))
    .filter((recipe) => recipe !== undefined);

  if (recipes.length !== plan.batchRecipeIds.length) {
    await refundGenerationQuota(input.householdId);
    throw notFound('Une recette du batch est introuvable. Régénère la semaine.');
  }

  let generated;
  try {
    generated = await generateBatchScheduleFromGemini(
      {
        recipes: recipes.map(({ id, name, prepMinutes, steps }) => ({
          id,
          name,
          prepMinutes,
          steps,
        })),
      },
      (attempt) => {
        void reportGenerationStep(
          input.householdId,
          input.weekId,
          attempt === 1 ? 'generating' : 'retrying',
          attempt,
        );
      },
    );
  } catch (error) {
    if (error instanceof GeminiUnavailableError) {
      await refundGenerationQuota(input.householdId);
      throw unavailable(
        'Le service de génération est saturé en ce moment. Ta génération n’a pas été ' +
          'décomptée : réessaie dans une minute.',
        error,
      );
    }
    if (error instanceof BatchScheduleGenerationError) {
      logger.error('déroulé abandonné', {
        violations: error.violations.map((violation) => violation.code),
      });
      throw internal(
        'Le déroulé proposé oubliait un plat, même après correction. Réessaie, ou cuisine ' +
          'recette par recette.',
        error,
      );
    }
    throw internal(
      'La composition du déroulé a échoué pour une raison inattendue. Réessaie dans un instant.',
      error,
    );
  }

  await reportGenerationStep(input.householdId, input.weekId, 'writing', generated.attempts);

  try {
    await writeBatchSchedule({
      householdId: input.householdId,
      weekId: input.weekId,
      sourceRecipeIds: plan.batchRecipeIds,
      schedule: generated.schedule,
      generatedBy: uid,
      model: generated.model,
    });
  } catch (error) {
    throw internal(
      'Le déroulé a bien été composé mais n’a pas pu être enregistré. Réessaie dans un instant.',
      error,
    );
  }

  logger.info('déroulé enregistré', {
    weekId: input.weekId,
    etapes: generated.schedule.steps.length,
    tentatives: generated.attempts,
  });
  return { weekId: input.weekId, stepCount: generated.schedule.steps.length, generated: true };
}

async function readPlanOrFail(householdId: string, weekId: string): Promise<WeeklyPlan> {
  try {
    return await readPlanForEdit(householdId, weekId);
  } catch (error) {
    if (error instanceof PlanNotFoundError) {
      throw notFound('Aucun plan pour cette semaine. Compose-la depuis l’accueil.');
    }
    throw error;
  }
}
