import { describe, expect, it } from 'vitest';
import { addDays, getDayNameForDate, getPlanningWeekId, getWeekDates, getWeekId, isWeekday } from '../week';

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
