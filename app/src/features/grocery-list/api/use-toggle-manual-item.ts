import { useMutation } from '@tanstack/react-query';
import { doc, updateDoc } from 'firebase/firestore';
import { paths } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface ToggleManualItemInput {
  householdId: string;
  itemId: string;
  /** Semaine de la liste où on le raye ; `null` pour le remettre à acheter. */
  checkedWeekId: string | null;
}

/**
 * Raye ou décoche un article ajouté à la main.
 *
 * Écrit la semaine plutôt qu'un booléen : rayé, l'article reste visible coché
 * dans cette semaine-là et quitte les suivantes. Écriture directe, comme
 * `useToggleGroceryItem`, et pour la même raison — on la fait en magasin.
 */
export function useToggleManualItem() {
  return useMutation({
    mutationFn: async ({ householdId, itemId, checkedWeekId }: ToggleManualItemInput) => {
      await updateDoc(doc(db, paths.manualItem(householdId, itemId)), { checkedWeekId });
    },
    retry: 0,
  });
}
