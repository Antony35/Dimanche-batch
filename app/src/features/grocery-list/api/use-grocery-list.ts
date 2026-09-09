import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  GroceryItemSchema,
  groupByAisle,
  paths,
  type Aisle,
  type GroceryItem,
} from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface GroceryListState {
  items: GroceryItem[];
  /** Articles regroupés dans l'ordre de parcours du magasin. */
  groups: { aisle: Aisle; items: GroceryItem[] }[];
  checkedCount: number;
  isLoading: boolean;
  error: Error | null;
}

interface SnapshotState {
  key: string | null;
  items: GroceryItem[];
  error: Error | null;
}

const INITIAL: SnapshotState = { key: null, items: [], error: null };

/**
 * Liste de courses d'une semaine, en temps réel.
 *
 * L'écoute porte sur la sous-collection plutôt que sur un tableau : c'est ce
 * qui permet aux Security Rules de n'autoriser que `checked`, et c'est aussi ce
 * qui laisse deux personnes cocher en même temps dans le magasin sans que l'une
 * écrase l'autre.
 *
 * Le regroupement par rayon est calculé ici et pas dans l'écran : c'est de la
 * logique de domaine, elle est testée dans `shared`.
 */
export function useGroceryList(householdId: string | null, weekId: string): GroceryListState {
  const [state, setState] = useState<SnapshotState>(INITIAL);
  const key = householdId ? `${householdId}/${weekId}` : null;

  useEffect(() => {
    if (!householdId) return;

    return onSnapshot(
      collection(db, paths.groceryItems(householdId, weekId)),
      (snapshot) => {
        const items: GroceryItem[] = [];
        let unreadable = 0;

        for (const document of snapshot.docs) {
          const parsed = GroceryItemSchema.safeParse({ id: document.id, ...document.data() });
          if (parsed.success) {
            items.push(parsed.data);
            continue;
          }
          // Écarter en silence rendrait une liste illisible indiscernable d'une
          // liste vide, et le diagnostic impossible depuis le téléphone.
          unreadable += 1;
          console.warn('article de courses illisible', document.id, parsed.error.issues);
        }

        setState({
          key: `${householdId}/${weekId}`,
          items,
          error:
            unreadable > 0
              ? new Error(
                  `${unreadable} article(s) enregistré(s) dans un format que l’application ne ` +
                    'comprend pas. Régénère la semaine depuis l’accueil.',
                )
              : null,
        });
      },
      (error) => setState({ key: `${householdId}/${weekId}`, items: [], error }),
    );
  }, [householdId, weekId]);

  if (!householdId) {
    return { items: [], groups: [], checkedCount: 0, isLoading: false, error: null };
  }
  if (state.key !== key) {
    return { items: [], groups: [], checkedCount: 0, isLoading: true, error: null };
  }

  return {
    items: state.items,
    groups: groupByAisle(state.items),
    checkedCount: state.items.filter((item) => item.checked).length,
    isLoading: false,
    error: state.error,
  };
}
