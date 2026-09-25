import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  SetMealInputSchema,
  addDays,
  isBatchDayPast,
  isLastMealOfBatchDish,
  type Meal,
  type SetMealChoice,
  type SetMealInput,
  type SetMealResult,
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
  readPlanForEdit,
  readPlanRecipes,
  readRecipesByIds,
  setPlanMeal,
} from '../lib/plan-writer';

/**
 * Choisit un repas sans passer par le modèle.
 *
 * Trois gestes : servir une portion d'un plat du batch, déclarer qu'on mange
 * dehors, ou finir un reste du batch de la semaine précédente — qui n'achète
 * rien, et allège donc la liste de courses. Vider ainsi le dernier repas d'un
 * plat du batch retire le plat : on le cuisinerait sinon pour personne.
 * Aucun appel à Gemini, donc **aucun quota
 * consommé** — décompter une génération pour un choix que l'utilisateur fait
 * lui-même n'aurait aucun sens.
 *
 * Le verrou, en revanche, est bien pris : cette function recalcule
 * intégralement la liste de courses, exactement comme une régénération. Deux
 * téléphones qui changent chacun un repas en même temps verraient le second
 * écraser le travail du premier.
 *
 * Aucune règle Firestore n'est ajoutée : `weeklyPlans` reste fermé au client, et
 * c'est volontaire. `batchRecipeIds` et `days` gouvernent la liste de courses ;
 * les ouvrir en écriture permettrait de lui faire dire n'importe quoi.
 */
export const setMeal = onCall(
  {
    region: REGION,
    memory: DEFAULT_MEMORY,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxInstances: MAX_INSTANCES,
  },
  async (request): Promise<SetMealResult> => {
    logger.info('setMeal appelée', { authentifie: Boolean(request.auth) });

    const uid = requireAuth(request);
    const input: SetMealInput = parseInput(SetMealInputSchema, request.data, 'setMeal');

    await requireHouseholdMember(uid, input.householdId);

    let plan;
    try {
      plan = await readPlanForEdit(input.householdId, input.weekId);
    } catch (error) {
      if (error instanceof PlanNotFoundError) {
        throw notFound('Aucun plan pour cette semaine. Compose-la d’abord depuis l’accueil.');
      }
      throw error;
    }

    if (!plan.days.some((day) => day.date === input.date)) {
      throw invalidArgument('Ce jour ne fait pas partie de la semaine planifiée.');
    }

    // Vider le dernier repas d'un plat du batch retire le plat (`setPlanMeal`).
    // Deux cas restent refusés : y servir un autre plat du batch — l'échange
    // fait la même chose sans perdre de plat —, et le faire une fois le batch
    // cuisiné, quand le plat est au frigo et qu'il faudra bien le manger.
    const current = plan.days.find((day) => day.date === input.date)?.[input.slot];
    const keepsSameDish =
      input.meal.choice === 'batch' && current?.recipeId === input.meal.recipeId;
    if (isLastMealOfBatchDish(plan, input.date, input.slot) && !keepsSameDish) {
      if (isBatchDayPast(plan.weekStart, todayInParis())) {
        throw invalidArgument(
          'C’est le dernier repas de ce plat, déjà cuisiné : échange-le plutôt avec un autre repas.',
        );
      }
      if (input.meal.choice === 'batch') {
        throw invalidArgument(
          'C’est le dernier repas de ce plat du batch : échange-le, ou retire le plat pour cuisiner moins.',
        );
      }
    }

    const previousBatchRecipeIds =
      input.meal.choice === 'previous-leftover'
        ? await readPreviousBatchRecipeIds(input.householdId, input.weekId)
        : [];
    const meal = toMeal(input.meal, plan.batchRecipeIds, previousBatchRecipeIds);
    const knownRecipes = await readPlanRecipes(input.householdId, plan);
    if (meal.recipeId !== null && !knownRecipes.has(meal.recipeId)) {
      // Un reste de la semaine précédente n'est pas dans ce plan : sa recette
      // sert à nommer le repas, jamais à acheter.
      for (const [id, recipe] of await readRecipesByIds(input.householdId, [meal.recipeId])) {
        knownRecipes.set(id, recipe);
      }
    }

    await acquireGenerationLock(input.householdId, input.weekId, uid);
    try {
      const outcome = await setPlanMeal({
        householdId: input.householdId,
        plan,
        date: input.date,
        slot: input.slot,
        meal,
        recipeToWrite: null,
        knownRecipes,
      });

      logger.info('repas choisi', {
        weekId: outcome.weekId,
        choix: input.meal.choice,
        articles: outcome.itemCount,
      });

      return outcome;
    } catch (error) {
      if (error instanceof PlanNotFoundError) {
        throw invalidArgument(
          'Le plan de la semaine a changé pendant l’enregistrement, sans doute depuis l’autre ' +
            'téléphone. Rouvre le planning et réessaie.',
        );
      }
      throw internal('Le choix n’a pas pu être enregistré. Réessaie dans un instant.', error);
    } finally {
      await releaseGenerationLock(input.householdId, input.weekId);
    }
  },
);

/** Plats du batch de la semaine précédente, les seuls dont il peut rester des portions. */
async function readPreviousBatchRecipeIds(householdId: string, weekId: string): Promise<string[]> {
  try {
    const previous = await readPlanForEdit(householdId, addDays(weekId, -7));
    return previous.batchRecipeIds;
  } catch (error) {
    if (error instanceof PlanNotFoundError) return [];
    throw error;
  }
}

/**
 * Traduit le choix de l'utilisateur en repas.
 *
 * Servir un plat qui n'est pas au batch n'aurait pas de sens : il n'a pas été
 * cuisiné, et ses ingrédients ne figurent pas dans la liste de courses. Un reste
 * ne vient que du batch de la semaine précédente : sans cette vérification, on
 * poserait n'importe quelle recette du foyer comme « déjà cuisinée ».
 *
 * Exportée pour être testée : c'est la seule règle métier de cette function.
 */
export function toMeal(
  choice: SetMealChoice,
  batchRecipeIds: string[],
  previousBatchRecipeIds: string[] = [],
): Meal {
  if (choice.choice === 'eat-out') {
    return { recipeId: null, kind: 'eat-out', withStarter: false, withDessert: false };
  }

  if (choice.choice === 'previous-leftover') {
    if (!previousBatchRecipeIds.includes(choice.recipeId)) {
      throw invalidArgument('Ce plat ne faisait pas partie du batch de la semaine précédente.');
    }
    return {
      recipeId: choice.recipeId,
      kind: 'freezer-backup',
      withStarter: false,
      withDessert: false,
    };
  }

  if (!batchRecipeIds.includes(choice.recipeId)) {
    throw invalidArgument('Ce plat ne fait pas partie du batch de la semaine.');
  }

  return {
    recipeId: choice.recipeId,
    kind: 'batch-leftover',
    withStarter: false,
    withDessert: false,
  };
}
