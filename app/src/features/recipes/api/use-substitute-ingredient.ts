import { useMutation } from '@tanstack/react-query';
import type { SubstituteIngredientInput } from '@dimanche-batch/shared';
import { substituteIngredient } from '@/lib/callables';

/**
 * Remplace un ingrédient d'une recette par un autre de même catégorie.
 *
 * Aucun appel au modèle ni quota. Aucun retry : la function prend le verrou
 * des semaines dont elle recalcule la liste, et rejouer un remplacement déjà
 * passé se ferait refuser — l'ingrédient n'est plus dans la recette. La
 * recette et la liste reviennent par leurs listeners, sur les deux téléphones.
 */
export function useSubstituteIngredient() {
  return useMutation({
    mutationFn: (input: SubstituteIngredientInput) => substituteIngredient(input),
    retry: 0,
  });
}
