import { useMutation } from '@tanstack/react-query';
import { doc, updateDoc } from 'firebase/firestore';
import { paths } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface ToggleGroceryItemInput {
  householdId: string;
  weekId: string;
  itemId: string;
  checked: boolean;
}

/**
 * Coche ou décoche un article.
 *
 * Seule écriture Firestore directe de toute l'app — les Security Rules la
 * bornent au champ `checked`, et c'est précisément ce qui rend ce raccourci
 * sûr : passer par une callable n'ajouterait qu'une latence dans un magasin.
 *
 * Pas d'état optimiste à écrire à la main : le SDK Firestore applique
 * l'écriture localement avant de la confirmer au serveur, et le listener la
 * reflète dans la foulée. La case bascule immédiatement, même hors réseau.
 */
export function useToggleGroceryItem() {
  return useMutation({
    mutationFn: async ({ householdId, weekId, itemId, checked }: ToggleGroceryItemInput) => {
      await updateDoc(doc(db, paths.groceryItem(householdId, weekId, itemId)), { checked });
    },
    retry: 0,
  });
}
