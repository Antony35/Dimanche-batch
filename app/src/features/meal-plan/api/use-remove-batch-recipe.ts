import { useMutation } from '@tanstack/react-query';
import type { RemoveBatchRecipeInput } from '@dimanche-batch/shared';
import { removeBatchRecipe } from '@/lib/callables';

/**
 * Retire un plat du batch ; ses repas passent à décider.
 *
 * Aucun appel au modèle ni quota, mais aucun retry non plus : la function
 * prend le verrou de la semaine, et rejouer un retrait déjà passé se ferait
 * refuser. Le plan et la liste de courses reviennent par leurs listeners, sur
 * les deux téléphones à la fois.
 */
export function useRemoveBatchRecipe() {
  return useMutation({
    mutationFn: (input: RemoveBatchRecipeInput) => removeBatchRecipe(input),
    retry: 0,
  });
}
