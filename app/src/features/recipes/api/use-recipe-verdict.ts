import { useMutation } from '@tanstack/react-query';
import { doc, updateDoc } from 'firebase/firestore';
import { paths } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

/**
 * Message unique des deux verdicts : ils échouent pour la même raison, et deux
 * écrans les affichent. Deux copies finiraient par diverger.
 */
export const VERDICT_WRITE_ERROR =
  'Ton choix n’a pas pu être enregistré. Vérifie ta connexion.';

export interface RecipeVerdictInput {
  householdId: string;
  recipeId: string;
}

/**
 * Ce que le foyer pense d'une recette : il l'aime, il n'en veut plus, ou ni
 * l'un ni l'autre.
 *
 * Deux des cinq écritures Firestore directes de l'app, admises pour la même
 * raison que la case à cocher : les Security Rules les bornent à ces deux
 * champs, et le geste doit répondre à l'instant. Le contenu de la recette,
 * lui, reste hors d'atteinte du client.
 *
 * Les deux verdicts s'excluent — un plat qu'on ne veut plus manger ne peut pas
 * rester un favori, et le prompt ne saurait quoi faire des deux consignes à la
 * fois. L'exclusivité s'écrit ici, une seule fois : la règle borne les champs
 * modifiables, elle ne peut pas garantir leur cohérence.
 */
async function setVerdict(
  { householdId, recipeId }: RecipeVerdictInput,
  verdict: { isFavorite: boolean; isDisliked: boolean },
): Promise<void> {
  await updateDoc(doc(db, paths.recipe(householdId, recipeId)), verdict);
}

export function useToggleFavorite() {
  return useMutation({
    mutationFn: (input: RecipeVerdictInput & { isFavorite: boolean }) =>
      setVerdict(input, { isFavorite: input.isFavorite, isDisliked: false }),
    retry: 0,
  });
}

export function useToggleDislike() {
  return useMutation({
    mutationFn: (input: RecipeVerdictInput & { isDisliked: boolean }) =>
      setVerdict(input, { isFavorite: false, isDisliked: input.isDisliked }),
    retry: 0,
  });
}
