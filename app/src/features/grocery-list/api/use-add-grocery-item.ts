import { useMutation } from '@tanstack/react-query';
import { doc, setDoc } from 'firebase/firestore';
import { makeManualGroceryItem, paths, type Aisle, type Unit } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface AddGroceryItemInput {
  householdId: string;
  weekId: string;
  name: string;
  qty: number;
  unit: Unit;
  aisle: Aisle;
}

/**
 * Ajoute un article à la main.
 *
 * Écriture Firestore directe, pour la même raison que `checked` : on ajoute
 * « sac poubelle » debout dans un rayon, et une callable y mettrait un
 * aller-retour réseau. Ce qui la rend sûre est la Security Rule, qui enferme le
 * client dans l'espace de noms `manual--` et n'accepte là que des articles
 * `manual` aux champs bornés. L'article lui-même se construit dans le domaine.
 */
export function useAddGroceryItem() {
  return useMutation({
    mutationFn: async ({ householdId, weekId, ...input }: AddGroceryItemInput) => {
      const { id, ...item } = makeManualGroceryItem(input);
      await setDoc(doc(db, paths.groceryItem(householdId, weekId, id)), item);
    },
    retry: 0,
  });
}
