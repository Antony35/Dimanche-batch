import { describe, expect, it } from 'vitest';
import {
  BATCH_DAY_INDEX,
  addDays,
  formatDateLong,
  formatDuration,
  formatWeekRange,
  getComposableWeekId,
  getCurrentWeekId,
  getDayName,
  getDayNameForDate,
  getUpcomingWeekId,
  getWeekDates,
  getWeekId,
  isBatchDayPast,
  isComposableWeek,
  parseIsoDate,
  requiresFreezing,
  toIsoDate,
} from '../week';

/**
 * La semaine du foyer va du samedi au vendredi. Ces tests fixent ce choix
 * partout où il se manifeste, parce qu'il est contre-intuitif : c'est le cycle
 * du batch cooking — courses le samedi, batch le dimanche, portions ensuite.
 *
 * Repères du calendrier utilisés ici : samedi 12 septembre 2026, donc dimanche
 * 13, lundi 14, … vendredi 18, samedi 19.
 */

describe('getWeekId', () => {
  it('ramène toute date au samedi qui ouvre sa semaine', () => {
    expect(getWeekId(new Date(2026, 8, 12))).toBe('2026-09-12'); // samedi
    expect(getWeekId(new Date(2026, 8, 13))).toBe('2026-09-12'); // dimanche
    expect(getWeekId(new Date(2026, 8, 14))).toBe('2026-09-12'); // lundi
    expect(getWeekId(new Date(2026, 8, 18))).toBe('2026-09-12'); // vendredi
  });

  it('bascule le samedi, pas le lundi', () => {
    // Le vendredi 18 clôt la semaine ; le samedi 19 en ouvre une neuve.
    expect(getWeekId(new Date(2026, 8, 18))).toBe('2026-09-12');
    expect(getWeekId(new Date(2026, 8, 19))).toBe('2026-09-19');
  });

  it('franchit les bornes de mois et d’année', () => {
    expect(getWeekId(new Date(2026, 9, 1))).toBe('2026-09-26'); // jeudi 1er oct.
    expect(getWeekId(new Date(2027, 0, 1))).toBe('2026-12-26'); // vendredi 1er jan.
  });
});

describe('getCurrentWeekId et getUpcomingWeekId', () => {
  it('la semaine à préparer suit toujours celle qu’on mange', () => {
    const mercredi = new Date(2026, 8, 16);
    expect(getCurrentWeekId(mercredi)).toBe('2026-09-12');
    expect(getUpcomingWeekId(mercredi)).toBe('2026-09-19');
  });

  it('le vendredi, la semaine à préparer commence le lendemain', () => {
    // C'est le dernier moment utile pour générer et faire les courses à temps.
    const vendredi = new Date(2026, 8, 18);
    expect(getUpcomingWeekId(vendredi)).toBe('2026-09-19');
  });

  it('le dimanche, jour du batch, ne bascule rien', () => {
    // Le dimanche appartient encore à la semaine en cours, et c'est justement
    // le jour où l'on cuisine son batch : rien à faire basculer.
    const dimanche = new Date(2026, 8, 13);
    expect(getCurrentWeekId(dimanche)).toBe('2026-09-12');
    expect(getUpcomingWeekId(dimanche)).toBe('2026-09-19');
  });

  it('les deux semaines sont toujours distantes de sept jours', () => {
    for (let jour = 12; jour <= 18; jour += 1) {
      const date = new Date(2026, 8, jour);
      expect(addDays(getCurrentWeekId(date), 7)).toBe(getUpcomingWeekId(date));
    }
  });
});

describe('getWeekDates', () => {
  it('énumère du samedi au vendredi', () => {
    const dates = getWeekDates('2026-09-12');
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-09-12'); // samedi
    expect(dates[1]).toBe('2026-09-13'); // dimanche, jour du batch
    expect(dates[6]).toBe('2026-09-18'); // vendredi
  });
});

describe('noms de jours', () => {
  it('indexe à partir du samedi, comme le contrat Gemini', () => {
    expect(getDayName(0)).toBe('samedi');
    expect(getDayName(BATCH_DAY_INDEX)).toBe('dimanche');
    expect(getDayName(2)).toBe('lundi');
    expect(getDayName(6)).toBe('vendredi');
  });

  it('ne rend jamais `undefined` à l’écran', () => {
    expect(getDayName(7)).toBe('');
    expect(getDayName(-1)).toBe('');
  });

  it('nomme les jours à partir de leur date', () => {
    expect(getDayNameForDate('2026-09-12')).toBe('samedi');
    expect(getDayNameForDate('2026-09-13')).toBe('dimanche');
    expect(getDayNameForDate('2026-09-18')).toBe('vendredi');
  });

  it('reste cohérent avec les index de la semaine', () => {
    const dates = getWeekDates('2026-09-12');
    dates.forEach((date, index) => {
      expect(getDayNameForDate(date)).toBe(getDayName(index));
    });
  });
});

/**
 * Cette règle gouverne deux choses à la fois : la contrainte qui refuse un plan,
 * et la mention « à congeler » de l'écran du batch. Elle était écrite deux fois
 * avant d'atterrir ici — d'où ces tests, qui fixent la frontière exacte.
 */
describe('requiresFreezing', () => {
  it('vaut pour jeudi et vendredi, cinq et six jours après le batch', () => {
    expect(requiresFreezing(5)).toBe(true); // jeudi
    expect(requiresFreezing(6)).toBe(true); // vendredi
  });

  it('ne vaut pas jusqu’au mercredi, où le frigo suffit', () => {
    expect(requiresFreezing(2)).toBe(false); // lundi
    expect(requiresFreezing(3)).toBe(false); // mardi
    expect(requiresFreezing(4)).toBe(false); // mercredi
  });

  it('ne vaut pas non plus le week-end, cuisiné le jour même', () => {
    expect(requiresFreezing(0)).toBe(false); // samedi
    expect(requiresFreezing(1)).toBe(false); // dimanche
  });
});

describe('conversion date <-> ISO', () => {
  it('formate en heure locale, jamais en UTC', () => {
    // 23 h un 12 septembre reste le 12 : passer par UTC ferait basculer au 13
    // pour tout fuseau à l’est de Greenwich, et décalerait la semaine entière.
    expect(toIsoDate(new Date(2026, 8, 12, 23, 30))).toBe('2026-09-12');
    expect(toIsoDate(new Date(2026, 0, 5, 0, 15))).toBe('2026-01-05');
  });

  it('complète les mois et les jours à deux chiffres', () => {
    expect(toIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('fait l’aller-retour sans dérive', () => {
    for (const iso of getWeekDates('2026-10-24')) {
      expect(toIsoDate(parseIsoDate(iso))).toBe(iso);
    }
  });

  it('franchit correctement les bornes de mois et d’année', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

/**
 * Le format ISO reste celui du stockage, mais il s'affichait tel quel à six
 * endroits — jusqu'à « DIMANCHE 2026-09-20 » sur l'écran de préparation.
 */
describe('dates en français', () => {
  it('rend une date longue avec son jour de la semaine', () => {
    expect(formatDateLong('2026-09-12')).toBe('samedi 12 septembre');
    expect(formatDateLong('2026-08-01')).toBe('samedi 1 août');
  });

  it('ne répète le mois que s’il change', () => {
    expect(formatWeekRange('2026-09-12')).toBe('du 12 au 18 septembre');
    expect(formatWeekRange('2026-09-26')).toBe('du 26 septembre au 2 octobre');
  });

  it('ajoute les années au passage du 31 décembre', () => {
    expect(formatWeekRange('2026-12-26')).toBe('du 26 décembre 2026 au 1 janvier 2027');
  });

  it('couvre une semaine entière, du samedi au vendredi', () => {
    // La semaine du foyer a sept jours : le dernier est le vendredi.
    expect(formatWeekRange('2026-09-12')).toContain('18');
    expect(getDayNameForDate(addDays('2026-09-12', 6))).toBe('vendredi');
  });
});

/**
 * On ne compose que la semaine prochaine : jamais une semaine entamée, et pas
 * plus loin. Un oubli du vendredi ne coûte pas la semaine suivante : le samedi,
 * elle commence dans sept jours.
 */
describe('semaine composable', () => {
  it('propose la semaine suivante, jamais la semaine en cours', () => {
    // Mardi 15 septembre : la semaine en cours a commencé samedi 12.
    expect(getComposableWeekId('2026-09-15')).toBe('2026-09-19');
    expect(isComposableWeek('2026-09-12', '2026-09-15')).toBe(false);
  });

  it('laisse composer la semaine suivante le vendredi, qui commence demain', () => {
    expect(isComposableWeek('2026-09-19', '2026-09-18')).toBe(true);
  });

  it('refuse la semaine qui vient de commencer le samedi et le dimanche', () => {
    for (const today of ['2026-09-19', '2026-09-20']) {
      expect(isComposableWeek('2026-09-19', today)).toBe(false);
      expect(isComposableWeek('2026-09-26', today)).toBe(true);
    }
  });

  it('refuse la semaine d’après, et une date qui n’est pas un samedi', () => {
    expect(isComposableWeek('2026-09-26', '2026-09-15')).toBe(false);
    expect(isComposableWeek('2026-09-21', '2026-09-15')).toBe(false);
  });
});

describe('isBatchDayPast', () => {
  it('laisse renoncer à un plat jusqu’au dimanche du batch inclus', () => {
    // Semaine du samedi 12 : batch le dimanche 13.
    expect(isBatchDayPast('2026-09-12', '2026-09-08')).toBe(false);
    expect(isBatchDayPast('2026-09-12', '2026-09-12')).toBe(false);
    expect(isBatchDayPast('2026-09-12', '2026-09-13')).toBe(false);
    expect(isBatchDayPast('2026-09-12', '2026-09-14')).toBe(true);
  });
});

describe('formatDuration', () => {
  it('dit une durée comme on la dit en cuisine', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(150)).toBe('2 h 30');
  });
});
