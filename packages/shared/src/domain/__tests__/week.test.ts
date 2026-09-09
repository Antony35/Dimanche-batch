import { describe, expect, it } from 'vitest';
import {
  addDays,
  getDayName,
  getDayNameForDate,
  getPlanningWeekId,
  getWeekDates,
  getWeekId,
  isWeekday,
  parseIsoDate,
  toIsoDate,
} from '../week';

describe('week', () => {
  it('ramène toute date au lundi de sa semaine', () => {
    expect(getWeekId(new Date(2026, 8, 14))).toBe('2026-09-14'); // lundi
    expect(getWeekId(new Date(2026, 8, 17))).toBe('2026-09-14'); // jeudi
    expect(getWeekId(new Date(2026, 8, 20))).toBe('2026-09-14'); // dimanche
  });

  it('cible la semaine suivante quand on planifie un dimanche', () => {
    // Le dimanche, on prépare la semaine qui commence le lendemain.
    expect(getPlanningWeekId(new Date(2026, 8, 20))).toBe('2026-09-21');
    // En semaine, on reste sur la semaine en cours.
    expect(getPlanningWeekId(new Date(2026, 8, 17))).toBe('2026-09-14');
  });

  it('énumère les 7 jours dans l’ordre', () => {
    const dates = getWeekDates('2026-09-14');
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-09-14');
    expect(dates[6]).toBe('2026-09-20');
  });

  it('franchit correctement les bornes de mois et d’année', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(getWeekId(new Date(2027, 0, 1))).toBe('2026-12-28');
  });

  it('nomme les jours à partir de leur date', () => {
    expect(getDayNameForDate('2026-09-14')).toBe('lundi');
    expect(getDayNameForDate('2026-09-20')).toBe('dimanche');
  });

  it('classe lundi à vendredi comme jours de semaine', () => {
    expect(isWeekday(0)).toBe(true);
    expect(isWeekday(4)).toBe(true);
    expect(isWeekday(5)).toBe(false);
    expect(isWeekday(6)).toBe(false);
  });
});

describe('conversion date <-> ISO', () => {
  it('formate en heure locale, jamais en UTC', () => {
    // 23 h un 14 septembre reste le 14 : passer par UTC ferait basculer au 15
    // pour tout fuseau à l’est de Greenwich, et décalerait la semaine entière.
    expect(toIsoDate(new Date(2026, 8, 14, 23, 30))).toBe('2026-09-14');
    expect(toIsoDate(new Date(2026, 0, 5, 0, 15))).toBe('2026-01-05');
  });

  it('complète les mois et les jours à deux chiffres', () => {
    expect(toIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('fait l’aller-retour sans dérive', () => {
    for (const iso of getWeekDates('2026-10-26')) {
      expect(toIsoDate(parseIsoDate(iso))).toBe(iso);
    }
  });

  it('nomme les jours à partir de l’index, 0 = lundi', () => {
    expect(getDayName(0)).toBe('lundi');
    expect(getDayName(6)).toBe('dimanche');
    // Un index hors bornes ne doit pas rendre `undefined` à l’écran.
    expect(getDayName(7)).toBe('');
    expect(getDayName(-1)).toBe('');
  });
});
