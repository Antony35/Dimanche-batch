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

/**
 * Vrai pour jeudi et vendredi.
 *
 * Un plat du batch servi ces jours-là a été cuisiné le dimanche : il aurait
 * attendu cinq ou six jours au frigo, ce qui est trop. Il doit donc se congeler.
 *
 * La règle est ici, et nulle part ailleurs : elle gouverne à la fois la
 * contrainte de génération et ce que l'écran du batch marque « à congeler ».
 * L'écrire deux fois, c'est accepter qu'elles divergent en silence le jour où
 * le découpage de la semaine change.
 */
export function requiresFreezing(dayIndex: number): boolean {
  return dayIndex >= 5;
}

const MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/**
 * Date lisible par un francophone : `2026-09-14` devient `14/09/2026`.
 *
 * Le format ISO reste celui du stockage — il est la clé des documents de plan et
 * son ordre lexicographique est l'ordre chronologique, ce qui fait tenir le tri
 * de l'historique. Mais il n'a rien à faire sous les yeux de l'utilisateur, et
 * il y était à six endroits.
 *
 * Écrit à la main plutôt qu'avec `Intl.DateTimeFormat` : le résultat doit être
 * identique sur les deux téléphones et sous les tests, quelles que soient la
 * locale du système et les données ICU embarquées dans le binaire.
 */
export function formatDate(iso: IsoDate): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** `samedi 14 septembre` — pour les en-têtes, où le jour de la semaine porte le sens. */
export function formatDateLong(iso: IsoDate): string {
  const date = parseIsoDate(iso);
  return `${getDayNameForDate(iso)} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

/**
 * Étendue d'une semaine : `du 14 au 20 septembre`.
 *
 * Le mois n'est répété que s'il change, et l'année n'apparaît qu'au passage du
 * 31 décembre — répéter ce que le lecteur sait déjà allonge la ligne sans rien
 * lui apprendre.
 */
export function formatWeekRange(weekStart: WeekId): string {
  const start = parseIsoDate(weekStart);
  const end = parseIsoDate(addDays(weekStart, 6));

  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];

  if (start.getFullYear() !== end.getFullYear()) {
    return `du ${start.getDate()} ${startMonth} ${start.getFullYear()} au ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `du ${start.getDate()} ${startMonth} au ${end.getDate()} ${endMonth}`;
  }
  return `du ${start.getDate()} au ${end.getDate()} ${endMonth}`;
}

/**
 * La seule semaine que le foyer peut composer aujourd'hui : la suivante.
 *
 * Jamais la semaine en cours. Elle a commencé samedi, les courses sont faites
 * ou devraient l'être, et le batch est cuisiné ou sur le point de l'être : un
 * plan composé maintenant arriverait après le moment où il servait. Le samedi
 * et le dimanche, en revanche, la semaine suivante reste composable — elle
 * commence dans six ou sept jours, il y a tout le temps de s'organiser.
 *
 * Pas plus loin non plus : composer deux semaines d'avance, c'est choisir des
 * plats avant de savoir ce qui reste du batch précédent.
 */
export function getComposableWeekId(today: IsoDate): WeekId {
  return addDays(getWeekId(parseIsoDate(today)), 7);
}

/** Vrai si `weekStart` est la semaine composable à la date `today`. */
export function isComposableWeek(weekStart: WeekId, today: IsoDate): boolean {
  return weekStart === getComposableWeekId(today);
}
