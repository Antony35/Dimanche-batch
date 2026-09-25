import { useMutation } from '@tanstack/react-query';
import { deleteDoc, doc } from 'firebase/firestore';
import { paths } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface DeleteManualItemInput {
  householdId: string;
  itemId: string;
}

/** Supprime un article ajouté à la main : il quitte toutes les listes, passées comme à venir. */
export function useDeleteManualItem() {
  return useMutation({
    mutationFn: async ({ householdId, itemId }: DeleteManualItemInput) => {
      await deleteDoc(doc(db, paths.manualItem(householdId, itemId)));
    },
    retry: 0,
  });
}
