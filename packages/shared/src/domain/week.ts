import type { IsoDate, WeekId } from '../schemas/common';

/**
 * Toutes les dates du domaine sont des chaînes `YYYY-MM-DD` interprétées en
 * heure locale. Les helpers ci-dessous n'utilisent jamais les méthodes UTC de
 * `Date` : un plan généré un dimanche soir en France ne doit pas basculer sur
 * la semaine suivante à cause d'un décalage de fuseau.
 *
 * **La semaine du foyer va du samedi au vendredi**, et non du lundi au dimanche.
 * Ce n'est pas une convention arbitraire, c'est le cycle du batch cooking :
 *
 *   samedi     courses le matin, repas cuisinés le jour même
 *   dimanche   le batch est cuisiné, plus le repas du jour
 *   lundi→ven  portions du batch, un à cinq jours après la cuisson
 *
 * Avec une semaine lundi→dimanche, les courses du samedi devraient couvrir un
 * plat cuisiné le dimanche suivant, soit huit jours plus tard. En démarrant au
 * samedi, tout ce qui se cuisine frais l'est juste après les courses, et le
 * batch tombe à l'intérieur de la semaine qu'il nourrit.
 */

export function toIsoDate(date: Date): IsoDate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Samedi de la semaine contenant `date`. C'est l'identifiant d'un plan. */
export function getWeekId(date: Date = new Date()): WeekId {
  const saturday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() : 0 = dimanche … 6 = samedi. On veut 0 = samedi.
  const dayOfWeek = (saturday.getDay() + 1) % 7;
  saturday.setDate(saturday.getDate() - dayOfWeek);
  return toIsoDate(saturday);
}

/** Semaine qu'on mange aujourd'hui. */
export function getCurrentWeekId(date: Date = new Date()): WeekId {
  return getWeekId(date);
}

/**
 * Semaine qu'on prépare : celle qui suit la semaine en cours.
 *
 * Aucun cas particulier n'est nécessaire. Le dimanche appartient encore à la
 * semaine en cours, et c'est justement le jour où l'on cuisine son batch ; la
 * prochaine chose à préparer est donc toujours la semaine d'après.
 */
export function getUpcomingWeekId(date: Date = new Date()): WeekId {
  return addDays(getWeekId(date), 7);
}

export function getWeekDates(weekStart: WeekId): IsoDate[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

const DAY_NAMES = [
  'samedi',
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
] as const;

/** Index 0 = samedi, cohérent avec `dayIndex` du contrat Gemini. */
export function getDayName(dayIndex: number): string {
  return DAY_NAMES[dayIndex] ?? '';
}

export function getDayNameForDate(iso: IsoDate): string {
  return getDayName((parseIsoDate(iso).getDay() + 1) % 7);
}

/**
 * Jours nourris par le batch : lundi (2) à vendredi (6).
 *
 * Le samedi et le dimanche se cuisinent le jour même — ce sont les seuls où un
 * repas peut être `cooked`.
 */
export function isWeekday(dayIndex: number): boolean {
  return dayIndex >= 2 && dayIndex <= 6;
}

/** Index du jour où le batch est cuisiné : le dimanche. */
export const BATCH_DAY_INDEX = 1;
