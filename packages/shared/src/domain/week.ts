import type { IsoDate, WeekId } from '../schemas/common';

/**
 * Toutes les dates du domaine sont des chaînes `YYYY-MM-DD` interprétées en
 * heure locale. Les helpers ci-dessous n'utilisent jamais les méthodes UTC de
 * `Date` : un plan généré un dimanche soir en France ne doit pas basculer sur
 * la semaine suivante à cause d'un décalage de fuseau.
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

/** Lundi de la semaine contenant `date`. C'est l'identifiant d'un plan. */
export function getWeekId(date: Date = new Date()): WeekId {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfWeek = (monday.getDay() + 6) % 7; // 0 = lundi
  monday.setDate(monday.getDate() - dayOfWeek);
  return toIsoDate(monday);
}

/**
 * Semaine que l'app propose de générer. Le dimanche, on prépare la semaine
 * suivante — c'est le geste central de l'app, il ne doit pas demander de
 * réflexion à l'utilisateur.
 */
export function getPlanningWeekId(date: Date = new Date()): WeekId {
  const isSunday = date.getDay() === 0;
  return isSunday ? getWeekId(addDaysToDate(date, 1)) : getWeekId(date);
}

export function getWeekDates(weekStart: WeekId): IsoDate[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

const DAY_NAMES = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const;

/** Index 0 = lundi, cohérent avec `dayIndex` du contrat Gemini. */
export function getDayName(dayIndex: number): string {
  return DAY_NAMES[dayIndex] ?? '';
}

export function getDayNameForDate(iso: IsoDate): string {
  return getDayName((parseIsoDate(iso).getDay() + 6) % 7);
}

/** Les jours 0 à 4 sont soumis à la contrainte one-pot ; 5 et 6 sont libres. */
export function isWeekday(dayIndex: number): boolean {
  return dayIndex >= 0 && dayIndex <= 4;
}

function addDaysToDate(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}
