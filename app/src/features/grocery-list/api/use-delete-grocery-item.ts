import { useMutation } from '@tanstack/react-query';
import { deleteDoc, doc } from 'firebase/firestore';
import { paths } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface DeleteGroceryItemInput {
  householdId: string;
  weekId: string;
  itemId: string;
}

/**
 * Retire un article ajouté à la main.
 *
 * Septième écriture cliente. La règle n'autorise la suppression que d'un article
 * `manual` : un article calculé, lui, reviendrait au prochain recalcul sans
 * qu'on sache pourquoi, et le supprimer ferait sous-acheter en silence. L'écran
 * n'offre donc la poubelle que sur les articles manuels, et la règle le garantit
 * même si l'écran se trompe.
 */
export function useDeleteGroceryItem() {
  return useMutation({
    mutationFn: async ({ householdId, weekId, itemId }: DeleteGroceryItemInput) => {
      await deleteDoc(doc(db, paths.groceryItem(householdId, weekId, itemId)));
    },
    retry: 0,
  });
}
