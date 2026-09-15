import type { IsoDate } from '@dimanche-batch/shared';

/** Fuseau du foyer. Les deux téléphones sont en France. */
const HOUSEHOLD_TIME_ZONE = 'Europe/Paris';

/**
 * Date du jour pour le foyer, au format ISO.
 *
 * Les functions tournent en UTC : sans ce détour, le samedi entre minuit et
 * deux heures à Paris serait encore vendredi pour le serveur, et c'est
 * précisément la frontière qui décide si une semaine a commencé. Le format
 * `en-CA` rend `YYYY-MM-DD` directement.
 */
export function todayInParis(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HOUSEHOLD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
