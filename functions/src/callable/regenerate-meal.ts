import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  RegenerateMealInputSchema,
  WeeklyPlanSchema,
  findMeal,
  paths,
  type RegenerateMealInput,
  type RegenerateMealResult,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import {
  DEFAULT_MEMORY,
  DEFAULT_TIMEOUT_SECONDS,
  GEMINI_API_KEY,
  MAX_INSTANCES,
  REGION,
} from '../config';
import { db } from '../lib/firestore';
import { internal, invalidArgument, notFound, parseInput, unavailable } from '../lib/errors';
import {
  consumeGenerationQuota,
  refundGenerationQuota,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import { PlanNotFoundError, replaceMeal } from '../lib/plan-writer';
import { GeminiUnavailableError } from '../gemini/client';
import { MealGenerationError, generateMealRecipeFromGemini } from '../gemini/regenerate-meal';

/**
 * Remplace un seul repas d'un plan existant.
 *
 * Même ordre d'étapes que `generateWeeklyPlan` : identité, appartenance au
 * foyer, existence du créneau visé, et seulement ensuite la consommation du
 * quota. Un appel qui vise une date absente du plan ne doit rien coûter.
 */
export const regenerateMeal = onCall(
  {
    region: REGION,
    memory: DEFAULT_MEMORY,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxInstances: MAX_INSTANCES,
    secrets: [GEMINI_API_KEY],
  },
  async (request): Promise<RegenerateMealResult> => {
    logger.info('regenerateMeal appelée', { authentifie: Boolean(request.auth) });

    const uid = requireAuth(request);
    const input: RegenerateMealInput = parseInput(
      RegenerateMealInputSchema,
      request.data,
      'regenerateMeal',
    );

    await requireHouseholdMember(uid, input.householdId);

    const plan = await readPlan(input.householdId, input.weekId);
    const dayIndex = plan.days.findIndex((day) => day.date === input.date);
    if (dayIndex === -1) {
      throw invalidArgument('Ce jour ne fait pas partie de la semaine planifiée.');
    }

    await consumeGenerationQuota(input.householdId);

    const current = findMeal(plan, input.date, input.slot);
    const names = await readRecipeNames(input.householdId, plan.recipeIds);

    let generated;
    try {
      generated = await generateMealRecipeFromGemini({
        dayIndex,
        slot: input.slot,
        date: input.date,
        currentRecipeName: current?.recipeId ? (names.get(current.recipeId) ?? null) : null,
        otherRecipeNames: [...names.entries()]
          .filter(([id]) => id !== current?.recipeId)
          .map(([, name]) => name),
        notes: input.notes,
      });
    } catch (error) {
      // Aucun appel n'a abouti : la génération décomptée est rendue au foyer.
      if (error instanceof GeminiUnavailableError) {
        await refundGenerationQuota(input.householdId);
        throw unavailable(
          'Le service de génération est saturé en ce moment. Ta génération n’a pas été ' +
            'décomptée : réessaie dans une minute.',
          error,
        );
      }

      if (error instanceof MealGenerationError) {
        logger.error('remplacement abandonné', {
          violations: error.violations.map((violation) => violation.code),
        });
        throw internal(
          'Aucune recette proposée ne convenait à ce jour de la semaine, même après ' +
            'correction. Réessaie : le résultat varie d’une fois sur l’autre.',
          error,
        );
      }

      throw internal(
        'La recherche d’une recette a échoué pour une raison inattendue. Réessaie dans un instant.',
        error,
      );
    }

    try {
      const result = await replaceMeal({
        householdId: input.householdId,
        weekId: input.weekId,
        date: input.date,
        slot: input.slot,
        recipe: generated.recipe,
      });

      logger.info('repas remplacé', {
        weekId: result.weekId,
        recette: result.recipeId,
        articles: result.itemCount,
        tentatives: generated.attempts,
      });

      return result;
    } catch (error) {
      if (error instanceof PlanNotFoundError) {
        // Le plan a disparu entre la lecture et l'écriture : l'autre téléphone
        // a régénéré la semaine pendant l'appel.
        throw invalidArgument(
          'Le plan de la semaine a changé pendant la génération, sans doute depuis l’autre ' +
            'téléphone. Rouvre le planning et réessaie.',
        );
      }
      throw internal(
        'La recette a bien été trouvée mais n’a pas pu être enregistrée. Réessaie dans un instant.',
        error,
      );
    }
  },
);

async function readPlan(householdId: string, weekId: string): Promise<WeeklyPlan> {
  const snapshot = await db.doc(paths.weeklyPlan(householdId, weekId)).get();
  if (!snapshot.exists) {
    throw notFound(
      'Aucun plan pour cette semaine. Génère la semaine depuis l’accueil avant de changer un repas.',
    );
  }

  const parsed = WeeklyPlanSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
  if (!parsed.success) {
    throw internal('Le plan enregistré est illisible.', parsed.error.issues);
  }
  return parsed.data;
}

/** Noms des recettes du plan, pour que le modèle ne repropose pas un doublon. */
async function readRecipeNames(
  householdId: string,
  recipeIds: string[],
): Promise<Map<string, string>> {
  if (recipeIds.length === 0) return new Map();

  const snapshots = await Promise.all(
    recipeIds.map((id) => db.doc(paths.recipe(householdId, id)).get()),
  );

  const names = new Map<string, string>();
  for (const snapshot of snapshots) {
    const name = snapshot.get('name');
    if (typeof name === 'string') names.set(snapshot.id, name);
  }
  return names;
}
