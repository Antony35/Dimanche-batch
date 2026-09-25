import { useEffect, useState } from 'react';
import { collection, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { z } from 'zod';
import { ManualItemSchema, paths, type ManualItem } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { subscribeWithRetry } from '@/lib/firestore-subscribe';
import { cacheKeys, readCache, writeCache } from '@/lib/offline-cache';

const CachedItemsSchema = z.array(ManualItemSchema);

export interface ManualItemsState {
  items: ManualItem[];
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
}

interface SnapshotState {
  key: string | null;
  items: ManualItem[];
  isStale: boolean;
  error: Error | null;
}

const INITIAL: SnapshotState = { key: null, items: [], isStale: false, error: null };

/**
 * Articles ajoutés à la main par le foyer, toutes semaines confondues.
 *
 * Même contrat que `useGroceryList` — temps réel, cache disque pour le magasin
 * sans réseau, rejets comptés et dits —, sur une collection du foyer : c'est la
 * liste de chaque semaine qui choisit ceux qu'elle montre
 * (`manualItemsForWeek`).
 */
export function useManualItems(householdId: string | null): ManualItemsState {
  const [state, setState] = useState<SnapshotState>(INITIAL);

  useEffect(() => {
    if (!householdId) return;

    const cacheKey = cacheKeys.manualItems(householdId);
    let hasUsableData = false;

    // Hydratation depuis le disque : asynchrone par nature, donc écrite dans
    // l'état ; le drapeau tranche la course avec le premier snapshot.
    void readCache(cacheKey, CachedItemsSchema).then((cached) => {
      if (!cached || hasUsableData) return;
      setState({ key: householdId, items: cached, isStale: true, error: null });
    });

    return subscribeWithRetry<QuerySnapshot>(
      (onNext, onError) =>
        onSnapshot(
          collection(db, paths.manualItems(householdId)),
          { includeMetadataChanges: true },
          onNext,
          onError,
        ),
      (snapshot) => {
        hasUsableData = !snapshot.metadata.fromCache || snapshot.docs.length > 0;

        const items: ManualItem[] = [];
        let unreadable = 0;
        for (const document of snapshot.docs) {
          const parsed = ManualItemSchema.safeParse({ id: document.id, ...document.data() });
          if (parsed.success) {
            items.push(parsed.data);
            continue;
          }
          unreadable += 1;
          console.warn('article manuel illisible', document.id, parsed.error.issues);
        }

        setState({
          key: householdId,
          items,
          isStale: snapshot.metadata.fromCache,
          error:
            unreadable > 0
              ? new Error(
                  `${unreadable} article(s) ajouté(s) à la main dans un format que ` +
                    'l’application ne comprend pas. Supprime-les et ajoute-les de nouveau.',
                )
              : null,
        });

        // Seul ce que le serveur a confirmé est persisté.
        if (!snapshot.metadata.fromCache) void writeCache(cacheKey, items);
      },
      (error) => setState({ key: householdId, items: [], isStale: false, error }),
    );
  }, [householdId]);

  if (!householdId) return { items: [], isLoading: false, isStale: false, error: null };
  if (state.key !== householdId) return { items: [], isLoading: true, isStale: false, error: null };
  return { items: state.items, isLoading: false, isStale: state.isStale, error: state.error };
}
