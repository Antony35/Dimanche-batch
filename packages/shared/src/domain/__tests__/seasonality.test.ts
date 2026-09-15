import { describe, expect, it } from 'vitest';
import { SEASONAL_PRODUCE, describeSeasonalProduce, getSeasonalProduce } from '../seasonality';

describe('saisonnalité', () => {
  it('couvre les douze mois', () => {
    expect(SEASONAL_PRODUCE).toHaveLength(12);
    for (const month of SEASONAL_PRODUCE) {
      expect(month.vegetables.length).toBeGreaterThan(8);
      expect(month.fruits.length).toBeGreaterThan(2);
    }
  });

  it('lit le mois de la date donnée, pas celui du jour', () => {
    expect(getSeasonalProduce('2026-01-14').vegetables).toContain('poireau');
    expect(getSeasonalProduce('2026-07-14').vegetables).toContain('tomate');
  });

  // C'est la raison d'être du fichier : le modèle proposait des courgettes en
  // février parce que « de saison » ne veut rien dire pour lui.
  it('ne propose ni tomate ni courgette en hiver', () => {
    for (const month of [0, 1, 11]) {
      const vegetables = SEASONAL_PRODUCE[month]?.vegetables ?? [];
      expect(vegetables).not.toContain('tomate');
      expect(vegetables).not.toContain('courgette');
    }
  });

  it('propose la courge à l’automne et l’asperge au printemps', () => {
    expect(getSeasonalProduce('2026-10-03').vegetables).toContain('potiron');
    expect(getSeasonalProduce('2026-04-25').vegetables).toContain('asperge');
    expect(getSeasonalProduce('2026-10-03').vegetables).not.toContain('asperge');
  });

  it('rend deux lignes prêtes pour le prompt', () => {
    const described = describeSeasonalProduce('2026-09-19');
    expect(described).toContain('Légumes de saison : ');
    expect(described).toContain('Fruits de saison : ');
    expect(described.split('\n')).toHaveLength(2);
    expect(described).toContain('raisin');
  });
});
