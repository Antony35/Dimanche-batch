import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  SwapMealsInputSchema,
  findSwapCounterpart,
  type SwapMealsInput,
  type SwapMealsResult,
} from '@dimanche-batch/shared';
import { DEFAULT_MEMORY, DEFAULT_TIMEOUT_SECONDS, MAX_INSTANCES, REGION } from '../config';
import { internal, invalidArgument, parseInput } from '../lib/errors';
import {
  acquireGenerationLock,
  releaseGenerationLock,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import { readPlanOrFail } from '../lib/callable-support';
import { PlanNotFoundError, readPlanRecipes, swapPlanMeals } from '../lib/plan-writer';

/**
 * Échange deux repas du batch.
 *
 * L'ordre des plats dans la semaine est une proposition, pas une obligation :
 * on peut vouloir le chili mardi plutôt que jeudi. Mais les portions sont
 * comptées, donc on ne remplace pas, on échange — le créneau le plus éloigné
 * qui servait le chili reçoit ce que mardi servait. Le choix de ce créneau vit
 * dans le domaine (`findSwapCounterpart`), pas dans l'app.
 *
 * Aucun appel à Gemini, aucun quota. Le verrou est pris : deux échanges
 * simultanés depuis les deux téléphones partiraient du même plan et le second
 * écraserait le premier.
 */
export const swapMeals = onCall(
  {
    region: REGION,
    memory: DEFAULT_MEMORY,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxInstances: MAX_INSTANCES,
  },
  async (request): Promise<SwapMealsResult> => {
    logger.info('swapMeals appelée', { authentifie: Boolean(request.auth) });

    const uid = requireAuth(request);
    const input: SwapMealsInput = parseInput(SwapMealsInputSchema, request.data, 'swapMeals');

    await requireHouseholdMember(uid, input.householdId);

    await acquireGenerationLock(input.householdId, input.weekId, uid);
    try {
      const plan = await readPlanOrFail(input.householdId, input.weekId);
      const recipes = await readPlanRecipes(input.householdId, plan);
      const isFreezable = (recipeId: string) =>
        recipes.get(recipeId)?.tags.includes('congelable') ?? false;

      const ref = { date: input.date, slot: input.slot };
      const counterpart = findSwapCounterpart(plan, ref, input.recipeId, isFreezable);
      if (!counterpart) {
        throw invalidArgument(
          'Cet échange n’est pas possible : le plat ne se congèle pas, ou il n’est pas servi ailleurs cette semaine.',
        );
      }

      const { itemCount } = await swapPlanMeals({
        householdId: input.householdId,
        plan,
        first: ref,
        second: counterpart,
      });

      logger.info('repas échangés', { weekId: input.weekId, articles: itemCount });
      return {
        weekId: input.weekId,
        counterpartDate: counterpart.date,
        counterpartSlot: counterpart.slot,
      };
    } catch (error) {
      if (error instanceof PlanNotFoundError) {
        throw invalidArgument(
          'Le plan de la semaine a changé pendant l’échange, sans doute depuis l’autre téléphone. Rouvre le planning et réessaie.',
        );
      }
      if (error instanceof HttpsError) throw error;
      throw internal('L’échange n’a pas pu être enregistré. Réessaie dans un instant.', error);
    } finally {
      await releaseGenerationLock(input.householdId, input.weekId);
    }
  },
);
