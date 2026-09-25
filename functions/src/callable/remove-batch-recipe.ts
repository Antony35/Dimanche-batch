import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  BatchRecipeNotFoundError,
  RemoveBatchRecipeInputSchema,
  isBatchDayPast,
  type RemoveBatchRecipeInput,
  type RemoveBatchRecipeResult,
} from '@dimanche-batch/shared';
import { DEFAULT_MEMORY, DEFAULT_TIMEOUT_SECONDS, MAX_INSTANCES, REGION } from '../config';
import { readPlanOrFail } from '../lib/callable-support';
import { todayInParis } from '../lib/clock';
import { internal, invalidArgument, parseInput } from '../lib/errors';
import {
  acquireGenerationLock,
  releaseGenerationLock,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import { PlanNotFoundError, removeBatchRecipe } from '../lib/plan-writer';

/**
 * Retire un plat du batch, sans le remplacer.
 *
 * Le frigo contient déjà de quoi tenir une partie de la semaine : le foyer
 * cuisine moins. Les repas que servait le plat passent à décider, et ses
 * ingrédients quittent la liste de courses. Callable à part plutôt qu'un mode
 * de `replaceBatchRecipe` : l'une appelle Gemini et décompte une génération,
 * celle-ci ne fait ni l'un ni l'autre.
 *
 * Refusé une fois le dimanche du batch passé : le plat est cuisiné, il est au
 * frigo, et l'effacer du plan n'effacerait que le moyen de savoir quand le
 * manger. Le verrou de semaine est pris, la liste étant recalculée.
 */
export const removeBatchRecipeCallable = onCall(
  {
    region: REGION,
    memory: DEFAULT_MEMORY,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxInstances: MAX_INSTANCES,
  },
  async (request): Promise<RemoveBatchRecipeResult> => {
    logger.info('removeBatchRecipe appelée', { authentifie: Boolean(request.auth) });

    const uid = requireAuth(request);
    const input: RemoveBatchRecipeInput = parseInput(
      RemoveBatchRecipeInputSchema,
      request.data,
      'removeBatchRecipe',
    );

    await requireHouseholdMember(uid, input.householdId);

    const plan = await readPlanOrFail(input.householdId, input.weekId);
    if (!plan.batchRecipeIds.includes(input.recipeId)) {
      throw invalidArgument(
        'Ce plat ne fait plus partie du batch, sans doute retiré depuis l’autre téléphone.',
      );
    }
    if (isBatchDayPast(plan.weekStart, todayInParis())) {
      throw invalidArgument(
        'Le batch de cette semaine est déjà cuisiné : le plat est au frigo. Échange plutôt ses repas.',
      );
    }

    await acquireGenerationLock(input.householdId, input.weekId, uid);
    try {
      const result = await removeBatchRecipe(input);
      logger.info('plat retiré du batch', {
        weekId: result.weekId,
        recette: input.recipeId,
        repas: result.mealCount,
        articles: result.itemCount,
      });
      return result;
    } catch (error) {
      if (error instanceof PlanNotFoundError || error instanceof BatchRecipeNotFoundError) {
        throw invalidArgument(
          'Le plan de la semaine a changé pendant l’enregistrement, sans doute depuis l’autre ' +
            'téléphone. Rouvre le batch et réessaie.',
        );
      }
      if (error instanceof HttpsError) throw error;
      throw internal('Le plat n’a pas pu être retiré. Réessaie dans un instant.', error);
    } finally {
      await releaseGenerationLock(input.householdId, input.weekId);
    }
  },
);
