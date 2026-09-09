import { useMutation } from '@tanstack/react-query';
import type { SetMealInput } from '@dimanche-batch/shared';
import { setMeal } from '@/lib/callables';

/**
 * Pose un repas choisi par l'utilisateur : une portion du batch, ou rien.
 *
 * Aucun appel au modèle, donc aucune génération décomptée — contrairement à
 * `useRegenerateMeal`, qui compose une nouvelle recette. C'est la distinction
 * que l'interface doit rendre visible avant de déclencher l'un ou l'autre.
 */
export function useSetMeal() {
  return useMutation({
    mutationFn: (input: SetMealInput) => setMeal(input),
    retry: 0,
  });
}
