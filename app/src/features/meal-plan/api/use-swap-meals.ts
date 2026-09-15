import { useMutation } from '@tanstack/react-query';
import type { SwapMealsInput } from '@dimanche-batch/shared';
import { swapMeals } from '@/lib/callables';

/**
 * Échange deux repas du batch.
 *
 * Aucun appel au modèle, aucune génération décomptée, et la liste de courses
 * ne change pas : chaque plat sert le même nombre de repas qu'avant.
 */
export function useSwapMeals() {
  return useMutation({
    mutationFn: (input: SwapMealsInput) => swapMeals(input),
    retry: 0,
  });
}
