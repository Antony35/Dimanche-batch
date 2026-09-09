import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { WeeklyPlanSchema, paths, type WeeklyPlan } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

/** Au-delà, on ne consulte plus un historique : on cherche une recette. */
const MAX_WEEKS = 12;

export interface WeekHistoryState {
  weeks: WeeklyPlan[];
  isLoading: boolean;
  error: Error | null;
}

interface SnapshotState {
  key: string | null;
  weeks: WeeklyPlan[];
  error: Error | null;
}

const INITIAL: SnapshotState = { key: null, weeks: [], error: null };

/**
 * Semaines passées, de la plus récente à la plus ancienne.
 *
 * Le tri porte sur `weekStart`, une date ISO : l'ordre lexicographique y est
 * l'ordre chronologique, aucun index composite n'est nécessaire.
 */
export function useWeekHistory(householdId: string | null): WeekHistoryState {
  const [state, setState] = useState<SnapshotState>(INITIAL);

  useEffect(() => {
    if (!householdId) return;

    const weeksQuery = query(
      collection(db, paths.weeklyPlans(householdId)),
      orderBy('weekStart', 'desc'),
      limit(MAX_WEEKS),
    );

    return onSnapshot(
      weeksQuery,
      (snapshot) => {
        const weeks: WeeklyPlan[] = [];
        let unreadable = 0;

        for (const document of snapshot.docs) {
          const parsed = WeeklyPlanSchema.safeParse({ id: document.id, ...document.data() });
          if (parsed.success) weeks.push(parsed.data);
          else unreadable += 1;
        }

        setState({
          key: householdId,
          weeks,
          error:
            unreadable > 0
              ? new Error(`${unreadable} semaine(s) enregistrée(s) dans un format illisible.`)
              : null,
        });
      },
      (error) => setState({ key: householdId, weeks: [], error }),
    );
  }, [householdId]);

  if (!householdId) return { weeks: [], isLoading: false, error: null };
  if (state.key !== householdId) return { weeks: [], isLoading: true, error: null };
  return { weeks: state.weeks, isLoading: false, error: state.error };
}
