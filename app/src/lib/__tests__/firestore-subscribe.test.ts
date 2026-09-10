import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirestoreError, Unsubscribe } from 'firebase/firestore';
import { subscribeWithRetry } from '../firestore-subscribe';

/**
 * Ce mécanisme est ce qui empêche un refus d'une seconde de laisser un écran
 * mort pour toujours : Firestore arrête définitivement un listener qui échoue.
 * Trois bugs visibles — bandeau rouge à la création du foyer, progression
 * figée, accueil qui ne voyait jamais le plan écrit — n'en étaient qu'un seul.
 *
 * Ces tests fixent les délais exacts, parce qu'ils décrivent la fenêtre qu'on
 * cherche à couvrir : celle où la règle `isMember` ne voit pas encore le foyer.
 */

const DELAYS = [500, 1_000, 2_000, 4_000, 8_000];

function fakeError(code = 'permission-denied'): FirestoreError {
  return { code, message: code, name: 'FirebaseError' } as FirestoreError;
}

/** Un faux abonnement dont le test décide quand il livre ou échoue. */
function makeSubscriber() {
  const calls: {
    next: (value: string) => void;
    fail: (error?: FirestoreError) => void;
  }[] = [];
  let unsubscribed = 0;

  const subscribe = (
    onNext: (value: string) => void,
    onError: (error: FirestoreError) => void,
  ): Unsubscribe => {
    calls.push({ next: onNext, fail: (error) => onError(error ?? fakeError()) });
    return () => {
      unsubscribed += 1;
    };
  };

  return {
    subscribe,
    calls,
    get attempts() {
      return calls.length;
    },
    get unsubscribed() {
      return unsubscribed;
    },
    last() {
      return calls[calls.length - 1]!;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('subscribeWithRetry', () => {
  it('livre les snapshots sans rien faire de plus quand tout va bien', () => {
    const source = makeSubscriber();
    const received: string[] = [];

    subscribeWithRetry(source.subscribe, (value) => received.push(value), () => {});
    source.last().next('plan');
    source.last().next('plan modifié');

    expect(received).toEqual(['plan', 'plan modifié']);
    expect(source.attempts).toBe(1);
  });

  it('se réabonne après un refus, au lieu de rester mort', () => {
    const source = makeSubscriber();
    const received: string[] = [];

    subscribeWithRetry(source.subscribe, (value) => received.push(value), () => {});
    source.last().fail();
    expect(source.attempts).toBe(1);

    vi.advanceTimersByTime(DELAYS[0]!);
    expect(source.attempts).toBe(2);

    source.last().next('plan');
    expect(received).toEqual(['plan']);
  });

  it('espace les reprises selon les délais annoncés', () => {
    const source = makeSubscriber();
    subscribeWithRetry(source.subscribe, () => {}, () => {});

    DELAYS.forEach((delay, index) => {
      source.last().fail();
      // Juste avant l'échéance, rien n'a bougé.
      vi.advanceTimersByTime(delay - 1);
      expect(source.attempts).toBe(index + 1);
      vi.advanceTimersByTime(1);
      expect(source.attempts).toBe(index + 2);
    });
  });

  it('abandonne après les cinq reprises, et une seule fois', () => {
    const source = makeSubscriber();
    const abandons: FirestoreError[] = [];
    subscribeWithRetry(source.subscribe, () => {}, (error) => abandons.push(error));

    for (const delay of DELAYS) {
      source.last().fail();
      vi.advanceTimersByTime(delay);
    }
    expect(abandons).toHaveLength(0);

    source.last().fail(fakeError('unavailable'));
    vi.advanceTimersByTime(60_000);

    expect(abandons).toHaveLength(1);
    expect(abandons[0]?.code).toBe('unavailable');
    expect(source.attempts).toBe(DELAYS.length + 1);
  });

  // Sans cette remise à zéro, une app ouverte depuis une heure n'aurait plus
  // aucune reprise disponible à sa première coupure de réseau.
  it('rend ses reprises à un abonnement qui a reçu un snapshot', () => {
    const source = makeSubscriber();
    const abandons: FirestoreError[] = [];
    subscribeWithRetry(source.subscribe, () => {}, (error) => abandons.push(error));

    for (const delay of DELAYS) {
      source.last().fail();
      vi.advanceTimersByTime(delay);
    }
    source.last().next('le serveur répond de nouveau');

    // Le compteur est reparti de zéro : cinq nouvelles reprises.
    for (const delay of DELAYS) {
      source.last().fail();
      vi.advanceTimersByTime(delay);
    }
    expect(abandons).toHaveLength(0);
  });

  it('coupe l’abonnement en cours au désabonnement', () => {
    const source = makeSubscriber();
    const stop = subscribeWithRetry(source.subscribe, () => {}, () => {});

    stop();

    expect(source.unsubscribed).toBe(1);
  });

  it('n’en relance pas un pendant que la reprise attend', () => {
    const source = makeSubscriber();
    const stop = subscribeWithRetry(source.subscribe, () => {}, () => {});

    source.last().fail();
    stop();
    vi.advanceTimersByTime(60_000);

    expect(source.attempts).toBe(1);
  });
});
