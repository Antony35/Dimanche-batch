import { useEffect, useState } from 'react';
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { CookingSessionSchema, paths, type CookingSession } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { subscribeWithRetry } from '@/lib/firestore-subscribe';

export interface CookingSessionState {
  session: CookingSession | null;
  isLoading: boolean;
  error: Error | null;
}

interface SnapshotState {
  key: string | null;
  session: CookingSession | null;
  error: Error | null;
}

/**
 * Session de cuisson de la semaine — découpes et étapes —, en temps réel.
 *
 * Écoutée plutôt que lue : si l'autre téléphone la compose, elle apparaît ici
 * sans rien toucher. Qu'elle soit à jour ou non se décide ailleurs —
 * `isCookingSessionCurrent` la compare au plan au moment de l'afficher.
 */
export function useCookingSession(householdId: string | null, weekId: string): CookingSessionState {
  const key = householdId ? `${householdId}/${weekId}` : null;
  const [state, setState] = useState<SnapshotState>({ key: null, session: null, error: null });

  useEffect(() => {
    if (!householdId) return;
    const stateKey = `${householdId}/${weekId}`;

    return subscribeWithRetry<DocumentSnapshot>(
      (onNext, onError) =>
        onSnapshot(doc(db, paths.batchSession(householdId, weekId)), onNext, onError),
      (snapshot) => {
        if (!snapshot.exists()) {
          setState({ key: stateKey, session: null, error: null });
          return;
        }
        const parsed = CookingSessionSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
        setState({
          key: stateKey,
          session: parsed.success ? parsed.data : null,
          error: parsed.success
            ? null
            : new Error('Les étapes de cuisson enregistrées sont illisibles.'),
        });
      },
      (error) => setState({ key: stateKey, session: null, error }),
    );
  }, [householdId, weekId]);

  if (!householdId) return { session: null, isLoading: false, error: null };
  if (state.key !== key) return { session: null, isLoading: true, error: null };
  return { session: state.session, isLoading: false, error: state.error };
}
