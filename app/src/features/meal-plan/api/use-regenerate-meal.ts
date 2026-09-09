import { useMutation } from '@tanstack/react-query';
import type { RegenerateMealInput } from '@dimanche-batch/shared';
import { regenerateMeal } from '@/lib/callables';

/**
 * Remplace un repas du plan.
 *
 * Aucun retry, pour la même raison que la génération complète : chaque appel
 * consomme le quota du foyer, et la function gère déjà sa propre reprise.
 *
 * Rien à réinjecter dans le cache non plus — le plan et les recettes reviennent
 * par leurs listeners Firestore, sur les deux téléphones à la fois.
 */
export function useRegenerateMeal() {
  return useMutation({
    mutationFn: (input: RegenerateMealInput) => regenerateMeal(input),
    retry: 0,
  });
}
