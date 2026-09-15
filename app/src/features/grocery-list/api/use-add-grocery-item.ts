import { useMutation } from '@tanstack/react-query';
import { doc, setDoc } from 'firebase/firestore';
import {
  dimensionOf,
  manualItemId,
  normalizeIngredientName,
  paths,
  toBaseQuantity,
  type Aisle,
  type GroceryItem,
  type Unit,
} from '@dimanche-batch/shared';
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
 * Sixième écriture Firestore directe de l'app, et elle est directe pour la même
 * raison que `checked` : on ajoute « sac poubelle » debout dans un rayon, et une
 * callable y mettrait un aller-retour réseau. Ce qui la rend sûre est la
 * Security Rule, qui enferme le client dans l'espace de noms `manual--` et
 * n'accepte là que des articles `manual` aux champs bornés.
 *
 * La quantité est ramenée en unité de base avant d'être écrite, comme le fait
 * l'agrégation : sans quoi « 1 kg de farine » et les 300 g d'une recette
 * tomberaient sur la même ligne avec des nombres incomparables.
 */
export function useAddGroceryItem() {
  return useMutation({
    mutationFn: async ({ householdId, weekId, name, qty, unit, aisle }: AddGroceryItemInput) => {
      const base = toBaseQuantity(qty, unit);
      const itemId = manualItemId(name, dimensionOf(unit));

      const item: Omit<GroceryItem, 'id'> = {
        name: normalizeIngredientName(name),
        qty: base.qty,
        unit: base.unit,
        aisle,
        checked: false,
        origin: 'manual',
        fromRecipeIds: [],
      };

      await setDoc(doc(db, paths.groceryItem(householdId, weekId, itemId)), item);
    },
    retry: 0,
  });
}
