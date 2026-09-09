import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  WeeklyPlanSchema,
  paths,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { cacheKeys, readCache, writeCache } from '@/lib/offline-cache';

export interface WeeklyPlanState {
  plan: WeeklyPlan | null;
  isLoading: boolean;
  /** Vrai tant que le serveur n'a pas confirmé ce qui est affiché. */
  isStale: boolean;
  error: Error | null;
}

interface SnapshotState extends WeeklyPlanState {
  /** Semaine à laquelle correspond l'état, pour détecter un snapshot périmé. */
  key: string | null;
}

const INITIAL: SnapshotState = {
  key: null,
  plan: null,
  isLoading: true,
  isStale: false,
  error: null,
};

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

    const stateKey = `${householdId}/${weekId}`;
    const cacheKey = cacheKeys.weeklyPlan(householdId, weekId);
    let hasServerData = false;

    // Savoir ce qu'on mange ce soir ne doit pas dépendre du réseau.
    void readCache(cacheKey, WeeklyPlanSchema).then((cached) => {
      if (!cached || hasServerData) return;
      setState({ key: stateKey, plan: cached, isLoading: false, isStale: true, error: null });
    });

    return onSnapshot(
      doc(db, paths.weeklyPlan(householdId, weekId)),
      (snapshot) => {
        hasServerData = true;
        const isStale = snapshot.metadata.fromCache;

        if (!snapshot.exists()) {
          setState({ key: stateKey, plan: null, isLoading: false, isStale, error: null });
          return;
        }

        const parsed = WeeklyPlanSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
        setState({
          key: stateKey,
          plan: parsed.success ? parsed.data : null,
          isLoading: false,
          isStale,
          error: parsed.success ? null : new Error('Le plan enregistré est illisible.'),
        });

        if (parsed.success && !isStale) void writeCache(cacheKey, parsed.data);
      },
      (error) =>
        setState({ key: stateKey, plan: null, isLoading: false, isStale: false, error }),
    );
  }, [householdId, weekId]);

  if (!householdId) return { plan: null, isLoading: false, isStale: false, error: null };
  if (state.key !== key) return { plan: null, isLoading: true, isStale: false, error: null };
  return {
    plan: state.plan,
    isLoading: state.isLoading,
    isStale: state.isStale,
    error: state.error,
  };
}
