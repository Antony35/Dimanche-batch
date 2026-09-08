import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  WeeklyPlanSchema,
  paths,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface WeeklyPlanState {
  plan: WeeklyPlan | null;
  isLoading: boolean;
  error: Error | null;
}

interface SnapshotState extends WeeklyPlanState {
  /** Semaine à laquelle correspond l'état, pour détecter un snapshot périmé. */
  key: string | null;
}

const INITIAL: SnapshotState = { key: null, plan: null, isLoading: true, error: null };

/**
 * Plan d'une semaine donnée, en temps réel.
 *
 * L'écoute plutôt qu'une lecture ponctuelle : quand l'autre téléphone lance la
 * génération du dimanche, le plan doit apparaître ici sans que personne ne
 * rafraîchisse quoi que ce soit.
 */
export function useWeeklyPlan(householdId: string | null, weekId: string): WeeklyPlanState {
  const [state, setState] = useState<SnapshotState>(INITIAL);
  const key = householdId ? `${householdId}/${weekId}` : null;

  useEffect(() => {
    if (!householdId) return;

    return onSnapshot(
      doc(db, paths.weeklyPlan(householdId, weekId)),
      (snapshot) => {
        if (!snapshot.exists()) {
          setState({ key: `${householdId}/${weekId}`, plan: null, isLoading: false, error: null });
          return;
        }

        const parsed = WeeklyPlanSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
        setState({
          key: `${householdId}/${weekId}`,
          plan: parsed.success ? parsed.data : null,
          isLoading: false,
          error: parsed.success ? null : new Error('Le plan enregistré est illisible.'),
        });
      },
      (error) => setState({ key: `${householdId}/${weekId}`, plan: null, isLoading: false, error }),
    );
  }, [householdId, weekId]);

  if (!householdId) return { plan: null, isLoading: false, error: null };
  if (state.key !== key) return { plan: null, isLoading: true, error: null };
  return { plan: state.plan, isLoading: state.isLoading, error: state.error };
}
