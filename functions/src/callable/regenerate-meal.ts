import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  RegenerateMealInputSchema,
  findMeal,
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
import { internal, invalidArgument, parseInput } from '../lib/errors';
import {
  acquireGenerationLock,
  consumeGenerationQuota,
  releaseGenerationLock,
  reportGenerationStep,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import { PlanNotFoundError, readPlanRecipes, replaceMeal } from '../lib/plan-writer';
import { readBannedRecipeNames } from '../lib/recipe-memory';
import { rethrowIfUnavailable, readPlanOrFail } from '../lib/callable-support';
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

    const plan = await readPlanOrFail(
      input.householdId,
      input.weekId,
      'Aucun plan pour cette semaine. Compose la semaine depuis l’accueil avant de changer un repas.',
    );
    const dayIndex = plan.days.findIndex((day) => day.date === input.date);
    if (dayIndex === -1) {
      throw invalidArgument('Ce jour ne fait pas partie de la semaine planifiée.');
    }

    // Le verrou est celui de la semaine, pas du repas : deux régénérations
    // simultanées sur deux créneaux différents recalculeraient toutes deux la
    // liste de courses, et la seconde écraserait le travail de la première.
    await acquireGenerationLock(input.householdId, input.weekId, uid);
    try {
      return await replaceOneMeal(input, dayIndex, plan);
    } finally {
      await releaseGenerationLock(input.householdId, input.weekId);
    }
  },
);

/** Corps du remplacement, une fois l'appel jugé légitime et le verrou posé. */
async function replaceOneMeal(
  input: RegenerateMealInput,
  dayIndex: number,
  plan: WeeklyPlan,
): Promise<RegenerateMealResult> {
  await consumeGenerationQuota(input.householdId);

  const current = findMeal(plan, input.date, input.slot);
  const recipes = await readPlanRecipes(input.householdId, plan);
  const names = new Map([...recipes.values()].map((recipe) => [recipe.id, recipe.name]));
  // Le remplacement est le chemin le plus courant après un bannissement : on
  // rejette un plat depuis le planning, puis on le remplace dans la foulée.
  const bannedRecipeNames = await readBannedRecipeNames(input.householdId);

  let generated;
  try {
    generated = await generateMealRecipeFromGemini(
      {
        dayIndex,
        slot: input.slot,
        style: input.style,
        date: input.date,
        currentRecipeName: current?.recipeId ? (names.get(current.recipeId) ?? null) : null,
        otherRecipeNames: [...names.entries()]
          .filter(([id]) => id !== current?.recipeId)
          .map(([, name]) => name),
        bannedRecipeNames,
        notes: input.notes,
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
    await rethrowIfUnavailable(error, input.householdId);

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

  await reportGenerationStep(input.householdId, input.weekId, 'writing', generated.attempts);

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
}
