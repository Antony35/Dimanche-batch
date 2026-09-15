import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  GenerateBatchScheduleInputSchema,
  getBatchPortions,
  isScheduleCurrent,
  miseEnPlaceGroup,
  scaleIngredients,
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
import { internal, invalidArgument, notFound, parseInput } from '../lib/errors';
import {
  acquireGenerationLock,
  consumeGenerationQuota,
  refundGenerationQuota,
  releaseGenerationLock,
  reportGenerationStep,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import { readPlanRecipes } from '../lib/plan-writer';
import { readCookingSession, writeCookingSession } from '../lib/batch-schedule-writer';
import { rethrowIfUnavailable, readPlanOrFail } from '../lib/callable-support';
import {
  BatchScheduleGenerationError,
  generateBatchScheduleFromGemini,
} from '../gemini/generate-batch-schedule';

/**
 * Compose la session de cuisson du dimanche, à la demande : la découpe de
 * chaque ingrédient et les étapes de cuisson de chaque plat.
 *
 * Généré seulement si quelqu'un le demande, puis conservé : une génération par
 * batch, jamais une par consultation. Si une session à jour existe déjà —
 * l'autre téléphone vient de la composer — elle est rendue telle quelle, sans
 * rien décompter. La vérification se fait **sous le verrou** : sans lui, deux
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
      const existing = await readCookingSession(input.householdId, input.weekId);
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
        recipes: recipes.map((recipe) => ({
          id: recipe.id,
          name: recipe.name,
          cookMinutes: recipe.cookMinutes,
          // Les ingrédients des portions réellement cuisinées, pour que le
          // modèle ne réécrive pas une étape sur des quantités qui ont changé.
          ingredients: scaleIngredients(recipe, getBatchPortions(plan, recipe.id)).map(
            (ingredient) => ({
              name: ingredient.name,
              toCut: miseEnPlaceGroup(ingredient.name, ingredient.aisle) !== null,
            }),
          ),
          steps: recipe.steps,
        })),
      },
      recipes,
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
    await rethrowIfUnavailable(error, input.householdId);
    if (error instanceof BatchScheduleGenerationError) {
      logger.error('déroulé abandonné', {
        violations: error.violations.map((violation) => violation.code),
      });
      throw internal(
        'Les étapes de cuisson proposées ne tenaient pas, même après correction. Réessaie, ou ' +
          'cuisine recette par recette.',
        error,
      );
    }
    throw internal(
      'La composition des étapes de cuisson a échoué pour une raison inattendue. Réessaie dans un instant.',
      error,
    );
  }

  await reportGenerationStep(input.householdId, input.weekId, 'writing', generated.attempts);

  try {
    await writeCookingSession({
      householdId: input.householdId,
      weekId: input.weekId,
      sourceRecipeIds: plan.batchRecipeIds,
      session: generated.session,
      generatedBy: uid,
      model: generated.model,
    });
  } catch (error) {
    throw internal(
      'Les étapes de cuisson ont bien été composées mais n’ont pas pu être enregistrées. Réessaie dans un instant.',
      error,
    );
  }

  logger.info('session de cuisson enregistrée', {
    weekId: input.weekId,
    etapes: generated.session.steps.length,
    decoupes: generated.session.cuts.length,
    tentatives: generated.attempts,
  });
  return { weekId: input.weekId, stepCount: generated.session.steps.length, generated: true };
}
