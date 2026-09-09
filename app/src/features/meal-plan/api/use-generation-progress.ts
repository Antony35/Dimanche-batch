import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { GenerationLockSchema, paths, type GenerationLock } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

interface SnapshotState {
  /** Semaine à laquelle correspond l'état, pour écarter un snapshot périmé. */
  key: string | null;
  lock: GenerationLock | null;
}

const INITIAL: SnapshotState = { key: null, lock: null };

/**
 * Avancement de la génération en cours sur une semaine.
 *
 * L'appel à la callable n'émet rien avant sa réponse : c'est un aller-retour
 * HTTP. La function publie donc son étape dans le document de verrou, que ce
 * hook écoute — ce qui rend au passage visible une génération lancée depuis
 * l'autre téléphone.
 *
 * Ce qui remonte est validé comme tout le reste, et le schéma n'admet qu'un
 * code d'étape : aucune chaîne libre ne peut atteindre l'écran.
 */
export function useGenerationProgress(
  householdId: string | null,
  weekId: string,
): GenerationLock | null {
  const [state, setState] = useState<SnapshotState>(INITIAL);
  const key = householdId ? `${householdId}/${weekId}` : null;

  useEffect(() => {
    if (!householdId) return;
    const stateKey = `${householdId}/${weekId}`;

    return onSnapshot(
      doc(db, paths.generationLock(householdId, weekId)),
      (snapshot) => {
        if (!snapshot.exists()) {
          setState({ key: stateKey, lock: null });
          return;
        }
        const parsed = GenerationLockSchema.safeParse(snapshot.data());
        setState({ key: stateKey, lock: parsed.success ? parsed.data : null });
      },
      // Un verrou illisible n'est pas une erreur à montrer : la génération suit
      // son cours, seul son affichage est perdu.
      () => setState({ key: stateKey, lock: null }),
    );
  }, [householdId, weekId]);

  if (state.key !== key) return null;
  return state.lock;
}
