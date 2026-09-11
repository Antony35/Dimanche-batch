import { useEffect, useState } from 'react';
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { BatchScheduleSchema, paths, type BatchSchedule } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { subscribeWithRetry } from '@/lib/firestore-subscribe';

export interface BatchScheduleState {
  schedule: BatchSchedule | null;
  isLoading: boolean;
  error: Error | null;
}

interface SnapshotState {
  key: string | null;
  schedule: BatchSchedule | null;
  error: Error | null;
}

/**
 * Déroulé entrelacé de la semaine, en temps réel.
 *
 * Écouté plutôt que lu : si l'autre téléphone le compose, il apparaît ici sans
 * rien toucher. Qu'il soit à jour ou non se décide ailleurs — `isScheduleCurrent`
 * le compare au plan au moment de l'afficher.
 */
export function useBatchSchedule(householdId: string | null, weekId: string): BatchScheduleState {
  const key = householdId ? `${householdId}/${weekId}` : null;
  const [state, setState] = useState<SnapshotState>({ key: null, schedule: null, error: null });

  useEffect(() => {
    if (!householdId) return;
    const stateKey = `${householdId}/${weekId}`;

    return subscribeWithRetry<DocumentSnapshot>(
      (onNext, onError) =>
        onSnapshot(doc(db, paths.batchSchedule(householdId, weekId)), onNext, onError),
      (snapshot) => {
        if (!snapshot.exists()) {
          setState({ key: stateKey, schedule: null, error: null });
          return;
        }
        const parsed = BatchScheduleSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
        setState({
          key: stateKey,
          schedule: parsed.success ? parsed.data : null,
          error: parsed.success ? null : new Error('Le déroulé enregistré est illisible.'),
        });
      },
      (error) => setState({ key: stateKey, schedule: null, error }),
    );
  }, [householdId, weekId]);

  if (!householdId) return { schedule: null, isLoading: false, error: null };
  if (state.key !== key) return { schedule: null, isLoading: true, error: null };
  return { schedule: state.schedule, isLoading: false, error: state.error };
}
