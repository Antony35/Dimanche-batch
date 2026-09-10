import { useEffect, useState } from 'react';
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { WeeklyPlanSchema, paths, type WeeklyPlan } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { subscribeWithRetry } from '@/lib/firestore-subscribe';
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
    let hasUsableData = false;

    // Savoir ce qu'on mange ce soir ne doit pas dépendre du réseau.
    void readCache(cacheKey, WeeklyPlanSchema).then((cached) => {
      if (!cached || hasUsableData) return;
      setState({ key: stateKey, plan: cached, isLoading: false, isStale: true, error: null });
    });

    return subscribeWithRetry<DocumentSnapshot>(
      (onNext, onError) =>
        onSnapshot(
          doc(db, paths.weeklyPlan(householdId, weekId)),
          // Sans cette option, Firestore ne notifie pas un simple changement de
          // connexion : `isStale` ne repasserait jamais à vrai en perdant le réseau.
          { includeMetadataChanges: true },
          onNext,
          onError,
        ),
      (snapshot) => {
        const isStale = snapshot.metadata.fromCache;
        // Un snapshot vide venu du cache mémoire, au démarrage hors ligne, n'est
        // pas une réponse : le tenir pour telle ferait ignorer le cache disque.
        hasUsableData = !isStale || snapshot.exists();

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
      (error) => setState({ key: stateKey, plan: null, isLoading: false, isStale: false, error }),
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
