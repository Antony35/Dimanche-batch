import { useMutation } from '@tanstack/react-query';
import { doc, setDoc } from 'firebase/firestore';
import { makeManualItem, paths, type Aisle, type Unit } from '@dimanche-batch/shared';
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
 * client dans l'espace de noms `manual--` et n'y accepte que des articles aux
 * champs bornés. L'article lui-même se construit dans le domaine.
 *
 * L'article est rangé dans le foyer et non dans la semaine : saisi ici, il
 * figure aussi sur les listes suivantes tant qu'il n'est ni rayé ni supprimé.
 */
export function useAddGroceryItem() {
  return useMutation({
    mutationFn: async ({ householdId, ...input }: AddGroceryItemInput) => {
      const { id, ...item } = makeManualItem(input);
      await setDoc(doc(db, paths.manualItem(householdId, id)), item);
    },
    retry: 0,
  });
}
