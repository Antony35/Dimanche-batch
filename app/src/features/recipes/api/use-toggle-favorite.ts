import { useMutation } from '@tanstack/react-query';
import { doc, updateDoc } from 'firebase/firestore';
import { paths } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface ToggleFavoriteInput {
  householdId: string;
  recipeId: string;
  isFavorite: boolean;
}

/**
 * Met une recette en favori, ou l'en retire.
 *
 * Seconde et dernière écriture Firestore directe de l'app, admise pour la même
 * raison que la case à cocher : les Security Rules la bornent à `isFavorite`,
 * et le geste doit répondre à l'instant. Le contenu de la recette, lui, reste
 * hors d'atteinte du client.
 */
export function useToggleFavorite() {
  return useMutation({
    mutationFn: async ({ householdId, recipeId, isFavorite }: ToggleFavoriteInput) => {
      await updateDoc(doc(db, paths.recipe(householdId, recipeId)), { isFavorite });
    },
    retry: 0,
  });
}
