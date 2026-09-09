import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  SetMealInputSchema,
  type Meal,
  type SetMealChoice,
  type SetMealInput,
  type SetMealResult,
} from '@dimanche-batch/shared';
import { DEFAULT_MEMORY, DEFAULT_TIMEOUT_SECONDS, MAX_INSTANCES, REGION } from '../config';
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
  setPlanMeal,
} from '../lib/plan-writer';

/**
 * Choisit un repas sans passer par le modèle.
 *
 * Deux gestes seulement : servir une portion d'un plat déjà prévu au batch, ou
 * déclarer qu'on mange dehors. Aucun appel à Gemini, donc **aucun quota
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

    const plan = await readPlanForEdit(input.householdId, input.weekId).catch((error: unknown) => {
      if (error instanceof PlanNotFoundError) {
        throw notFound('Aucun plan pour cette semaine. Compose-la d’abord depuis l’accueil.');
      }
      throw error;
    });

    if (!plan.days.some((day) => day.date === input.date)) {
      throw invalidArgument('Ce jour ne fait pas partie de la semaine planifiée.');
    }

    const meal = toMeal(input.meal, plan.batchRecipeIds);
    const knownRecipes = await readPlanRecipes(input.householdId, plan);

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

/**
 * Traduit le choix de l'utilisateur en repas.
 *
 * Servir un plat qui n'est pas au batch n'aurait pas de sens : il n'a pas été
 * cuisiné, et ses ingrédients ne figurent pas dans la liste de courses.
 *
 * Exportée pour être testée : c'est la seule règle métier de cette function.
 */
export function toMeal(choice: SetMealChoice, batchRecipeIds: string[]): Meal {
  if (choice.choice === 'eat-out') {
    return { recipeId: null, kind: 'eat-out', withStarter: false, withDessert: false };
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
