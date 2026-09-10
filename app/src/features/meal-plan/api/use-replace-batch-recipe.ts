import { useMutation } from '@tanstack/react-query';
import type { ReplaceBatchRecipeInput } from '@dimanche-batch/shared';
import { replaceBatchRecipe } from '@/lib/callables';

/**
 * Remplace un plat du batch, et tous les repas qu'il servait.
 *
 * Aucun retry, comme les autres générations : chaque appel consomme le quota
 * du foyer, et la function gère déjà sa propre reprise. Le plan, les recettes
 * et la liste de courses reviennent par leurs listeners, sur les deux
 * téléphones à la fois.
 */
export function useReplaceBatchRecipe() {
  return useMutation({
    mutationFn: (input: ReplaceBatchRecipeInput) => replaceBatchRecipe(input),
    retry: 0,
  });
}
