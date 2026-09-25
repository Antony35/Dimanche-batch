import { useEffect, useState } from 'react';
import { collection, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { z } from 'zod';
import {
  GroceryItemSchema,
  groupByAisle,
  paths,
  withManualItems,
  type Aisle,
  type GroceryItem,
} from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { subscribeWithRetry } from '@/lib/firestore-subscribe';
import { cacheKeys, readCache, writeCache } from '@/lib/offline-cache';
import { useManualItems } from './use-manual-items';

const CachedItemsSchema = z.array(GroceryItemSchema);

export interface GroceryListState {
  items: GroceryItem[];
  /** Articles regroupés dans l'ordre de parcours du magasin. */
  groups: { aisle: Aisle; items: GroceryItem[] }[];
  checkedCount: number;
  /**
   * Articles manuels du foyer montrés dans cette semaine : ils se rayent et se
   * suppriment dans leur propre collection, pas dans celle de la semaine.
   */
  manualIds: ReadonlySet<string>;
  isLoading: boolean;
  /** Vrai tant que le serveur n'a pas confirmé ce qui est affiché. */
  isStale: boolean;
  error: Error | null;
}

interface SnapshotState {
  key: string | null;
  items: GroceryItem[];
  /** Vient du cache local, pas encore confirmé par le serveur. */
  isStale: boolean;
  error: Error | null;
}

const INITIAL: SnapshotState = { key: null, items: [], isStale: false, error: null };
const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Liste de courses d'une semaine, en temps réel et disponible hors ligne.
 *
 * Deux sources : les articles de la semaine, et les articles ajoutés à la main
 * par le foyer, qui passent d'une semaine à l'autre jusqu'à être rayés
 * (`withManualItems`).
 *
 * L'écoute porte sur la sous-collection plutôt que sur un tableau : c'est ce
 * qui permet aux Security Rules de n'autoriser que `checked`, et c'est aussi ce
 * qui laisse deux personnes cocher en même temps dans le magasin sans que l'une
 * écrase l'autre.
 *
 * Le cache AsyncStorage sert le cas qui compte : rouvrir l'app dans un magasin
 * sans réseau. Il n'est appliqué que si aucun snapshot n'est encore arrivé —
 * sinon il écraserait des données fraîches par des anciennes.
 */
export function useGroceryList(householdId: string | null, weekId: string): GroceryListState {
  const [state, setState] = useState<SnapshotState>(INITIAL);
  const manual = useManualItems(householdId);
  const key = householdId ? `${householdId}/${weekId}` : null;

  useEffect(() => {
    if (!householdId) return;

    const stateKey = `${householdId}/${weekId}`;
    const cacheKey = cacheKeys.groceryItems(householdId, weekId);
    let hasUsableData = false;

    // Hydratation depuis le disque : asynchrone par nature, donc écrite dans
    // l'état plutôt que dérivée au rendu.
    void readCache(cacheKey, CachedItemsSchema).then((cached) => {
      if (!cached || hasUsableData) return;
      setState({ key: stateKey, items: cached, isStale: true, error: null });
    });

    const unsubscribe = subscribeWithRetry<QuerySnapshot>(
      (onNext, onError) =>
        onSnapshot(
          collection(db, paths.groceryItems(householdId, weekId)),
          // Sans cette option, Firestore ne notifie pas un simple changement de
          // connexion : `isStale` ne repasserait jamais à vrai en perdant le réseau.
          { includeMetadataChanges: true },
          onNext,
          onError,
        ),
      (snapshot) => {
        // Au démarrage hors ligne, le SDK émet aussitôt un snapshot vide depuis
        // son cache mémoire. Le tenir pour une réponse ferait ignorer le cache
        // disque, qui lui a les données.
        hasUsableData = !snapshot.metadata.fromCache || snapshot.docs.length > 0;

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
          key: stateKey,
          items,
          isStale: snapshot.metadata.fromCache,
          error:
            unreadable > 0
              ? new Error(
                  `${unreadable} article(s) enregistré(s) dans un format que l’application ne ` +
                    'comprend pas. Régénère la semaine depuis l’accueil.',
                )
              : null,
        });

        // Ne persister que ce que le serveur a confirmé : un snapshot local
        // reflète nos propres écritures en attente, pas l'état du foyer.
        if (!snapshot.metadata.fromCache) void writeCache(cacheKey, items);
      },
      (error) => setState({ key: stateKey, items: [], isStale: false, error }),
    );

    return unsubscribe;
  }, [householdId, weekId]);

  if (!householdId) {
    return {
      items: [],
      groups: [],
      checkedCount: 0,
      manualIds: NO_IDS,
      isLoading: false,
      isStale: false,
      error: null,
    };
  }
  if (state.key !== key || manual.isLoading) {
    return {
      items: [],
      groups: [],
      checkedCount: 0,
      manualIds: NO_IDS,
      isLoading: true,
      isStale: false,
      error: null,
    };
  }

  const items = withManualItems(state.items, manual.items, weekId);
  return {
    items,
    groups: groupByAisle(items),
    checkedCount: items.filter((item) => item.checked).length,
    manualIds: new Set(manual.items.map((item) => item.id)),
    isLoading: false,
    isStale: state.isStale || manual.isStale,
    error: state.error ?? manual.error,
  };
}
