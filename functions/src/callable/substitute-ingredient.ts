import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  SubstituteIngredientInputSchema,
  SubstitutionError,
  getComposableWeekId,
  getWeekId,
  isBatchDayPast,
  parseIsoDate,
  type SubstituteIngredientInput,
  type SubstituteIngredientResult,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import { DEFAULT_MEMORY, DEFAULT_TIMEOUT_SECONDS, MAX_INSTANCES, REGION } from '../config';
import { todayInParis } from '../lib/clock';
import { internal, invalidArgument, notFound, parseInput } from '../lib/errors';
import {
  acquireGenerationLock,
  releaseGenerationLock,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import {
  PlanNotFoundError,
  RecipeNotFoundError,
  readPlanForEdit,
  substituteRecipeIngredient,
} from '../lib/plan-writer';

/**
 * Remplace un ingrédient d'une recette par un autre de la même catégorie —
 * viande pour viande, légume pour légume.
 *
 * Ni Gemini ni quota : le domaine décide seul de ce qui est permis
 * (`substituteIngredientInRecipe`), et la même fonction filtre ce que l'app
 * propose. Côté serveur parce que les recettes sont en lecture seule pour le
 * client, et que la liste de courses doit suivre : elle est recalculée pour la
 * semaine en cours et la suivante, là où la recette est encore à acheter.
 *
 * Une semaine dont le batch est déjà cuisiné n'est pas recalculée pour un plat
 * du batch : il est au frigo, et sa liste a servi. La recette change quand
 * même — c'est elle qu'on retrouvera la prochaine fois qu'elle sera proposée.
 */
export const substituteIngredient = onCall(
  {
    region: REGION,
    memory: DEFAULT_MEMORY,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxInstances: MAX_INSTANCES,
  },
  async (request): Promise<SubstituteIngredientResult> => {
    logger.info('substituteIngredient appelée', { authentifie: Boolean(request.auth) });

    const uid = requireAuth(request);
    const input: SubstituteIngredientInput = parseInput(
      SubstituteIngredientInputSchema,
      request.data,
      'substituteIngredient',
    );

    await requireHouseholdMember(uid, input.householdId);

    const today = todayInParis();
    const weekIds = await weeksBuyingRecipe(input, today);

    const locked: string[] = [];
    try {
      for (const weekId of weekIds) {
        await acquireGenerationLock(input.householdId, weekId, uid);
        locked.push(weekId);
      }

      const { recipe, ingredient } = await substituteRecipeIngredient({ ...input, weekIds });
      logger.info('ingrédient remplacé', { recette: recipe.id, semaines: weekIds });

      return { recipeId: recipe.id, ingredientName: ingredient.name, weekIds };
    } catch (error) {
      if (error instanceof SubstitutionError) throw invalidArgument(error.message);
      if (error instanceof RecipeNotFoundError) {
        throw notFound('Cette recette n’existe plus, sans doute remplacée par une régénération.');
      }
      if (error instanceof PlanNotFoundError) {
        throw invalidArgument(
          'Le plan de la semaine a changé pendant l’enregistrement. Réessaie dans un instant.',
        );
      }
      if (error instanceof HttpsError) throw error;
      throw internal('L’ingrédient n’a pas pu être remplacé. Réessaie dans un instant.', error);
    } finally {
      for (const weekId of locked) {
        await releaseGenerationLock(input.householdId, weekId);
      }
    }
  },
);

/** Semaine en cours et suivante, quand leur liste achète encore cette recette. */
async function weeksBuyingRecipe(
  input: SubstituteIngredientInput,
  today: string,
): Promise<string[]> {
  const candidates = [getWeekId(parseIsoDate(today)), getComposableWeekId(today)];
  const plans = await Promise.all(
    candidates.map((weekId) => readPlanIfAny(input.householdId, weekId)),
  );

  return plans
    .filter((plan): plan is WeeklyPlan => plan !== null)
    .filter((plan) => {
      const inBatch = plan.batchRecipeIds.includes(input.recipeId);
      if (inBatch) return !isBatchDayPast(plan.weekStart, today);
      return plan.recipeIds.includes(input.recipeId);
    })
    .map((plan) => plan.id);
}

async function readPlanIfAny(householdId: string, weekId: string): Promise<WeeklyPlan | null> {
  try {
    return await readPlanForEdit(householdId, weekId);
  } catch (error) {
    if (error instanceof PlanNotFoundError) return null;
    throw error;
  }
}
