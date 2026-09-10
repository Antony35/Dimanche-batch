import type { FirestoreError, Unsubscribe } from 'firebase/firestore';

/**
 * Un abonnement Firestore qui se rétablit après une erreur.
 *
 * Firestore **arrête définitivement** un listener qui échoue : après une
 * erreur, il ne reçoit plus jamais rien, même si la cause a disparu. C'est un
 * comportement documenté, et il transforme un incident d'une seconde en écran
 * mort jusqu'au prochain montage.
 *
 * Le cas concret qui l'impose : à la création du foyer, les écrans montent
 * leurs listeners sur ses sous-collections avant que la règle `isMember` — qui
 * fait un `get()` sur le document du foyer — ne voie ce document. Elle refuse,
 * et sans reprise le planning, la progression et les courses restent vides pour
 * toujours, alors que tout est en ordre une seconde plus tard.
 *
 * On réessaie donc, en espaçant : la fenêtre à couvrir est courte. Au-delà,
 * l'erreur est probablement vraie — quelqu'un a quitté le foyer, le réseau est
 * coupé — et elle remonte à l'utilisateur plutôt que de boucler en silence.
 */
const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

export function subscribeWithRetry<T>(
  subscribe: (onNext: (value: T) => void, onError: (error: FirestoreError) => void) => Unsubscribe,
  onNext: (value: T) => void,
  onGiveUp: (error: FirestoreError) => void,
): Unsubscribe {
  let attempt = 0;
  let unsubscribe: Unsubscribe | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const start = (): void => {
    if (stopped) return;
    unsubscribe = subscribe(
      (value) => {
        // Un snapshot reçu remet le compteur à zéro : une coupure d'une heure
        // plus tard a droit à ses propres essais.
        attempt = 0;
        onNext(value);
      },
      (error) => {
        unsubscribe = null;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          onGiveUp(error);
          return;
        }
        attempt += 1;
        timer = setTimeout(start, delay);
      },
    );
  };

  start();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe?.();
  };
}
