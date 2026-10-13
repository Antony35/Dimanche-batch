import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { msUntilNextDay, toIsoDate, type IsoDate } from '@dimanche-batch/shared';

/**
 * Date du jour, qui suit le passage de minuit.
 *
 * Lire `new Date()` pendant le rendu figeait la date au dernier rendu : une
 * app laissée ouverte du vendredi soir au samedi matin restait sur l'ancienne
 * semaine. La date est lue une fois, dans l'initialiseur, puis relue juste
 * après minuit et à chaque retour de l'app au premier plan — un téléphone en
 * veille suspend les minuteries.
 */
export function useToday(): IsoDate {
  const [today, setToday] = useState(() => toIsoDate(new Date()));

  useEffect(() => {
    const refresh = () => setToday(toIsoDate(new Date()));
    // Une seconde de marge : la minuterie peut partir quelques millisecondes
    // avant minuit, et relirait alors la veille.
    const timer = setTimeout(refresh, msUntilNextDay(new Date()) + 1_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [today]);

  return today;
}
