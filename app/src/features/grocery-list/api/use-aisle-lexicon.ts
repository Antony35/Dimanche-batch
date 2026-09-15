import { useEffect, useState } from 'react';
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { AisleLexiconSchema, paths, type Aisle } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { subscribeWithRetry } from '@/lib/firestore-subscribe';

export interface AisleLexiconState {
  /** Corrections du foyer, clé `aisleOverrideKey(nom)`. Vide tant que rien n'est lu. */
  overrides: ReadonlyMap<string, Aisle>;
  error: Error | null;
}

interface SnapshotState extends AisleLexiconState {
  key: string | null;
}

const EMPTY: ReadonlyMap<string, Aisle> = new Map();
const INITIAL: SnapshotState = { key: null, overrides: EMPTY, error: null };

/**
 * Rayons que le foyer a lui-même attribués.
 *
 * Écouté plutôt que lu une fois : une correction faite sur l'autre téléphone
 * doit servir ici à la saisie suivante. Un document illisible ne se tait pas —
 * il remonte en erreur, et la table livrée continue de répondre en attendant.
 */
export function useAisleLexicon(householdId: string | null): AisleLexiconState {
  const [state, setState] = useState<SnapshotState>(INITIAL);

  useEffect(() => {
    if (!householdId) return;

    return subscribeWithRetry<DocumentSnapshot>(
      (onNext, onError) => onSnapshot(doc(db, paths.aisleLexicon(householdId)), onNext, onError),
      (snapshot) => {
        if (!snapshot.exists()) {
          setState({ key: householdId, overrides: EMPTY, error: null });
          return;
        }
        const parsed = AisleLexiconSchema.safeParse(snapshot.data());
        setState(
          parsed.success
            ? {
                key: householdId,
                overrides: new Map(Object.entries(parsed.data.entries)),
                error: null,
              }
            : {
                key: householdId,
                overrides: EMPTY,
                error: new Error('Les corrections de rayon du foyer sont illisibles.'),
              },
        );
      },
      (error) => setState({ key: householdId, overrides: EMPTY, error }),
    );
  }, [householdId]);

  if (state.key !== householdId) return { overrides: EMPTY, error: null };
  return { overrides: state.overrides, error: state.error };
}
