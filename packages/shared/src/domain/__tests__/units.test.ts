import { describe, expect, it } from 'vitest';
import {
  dimensionOf,
  formatQuantity,
  roundUpQuantity,
  toBaseQuantity,
  toDisplayQuantity,
} from '../units';

describe('units', () => {
  it('ramène les unités de masse au gramme', () => {
    expect(toBaseQuantity(1.5, 'kg')).toEqual({ qty: 1500, unit: 'g' });
    expect(toBaseQuantity(200, 'g')).toEqual({ qty: 200, unit: 'g' });
  });

  it('ramène les unités de volume au millilitre', () => {
    expect(toBaseQuantity(1, 'l')).toEqual({ qty: 1000, unit: 'ml' });
    expect(toBaseQuantity(20, 'cl')).toEqual({ qty: 200, unit: 'ml' });
  });

  it('donne une dimension propre aux unités non convertibles', () => {
    expect(dimensionOf('cas')).not.toBe(dimensionOf('cac'));
    expect(dimensionOf('cas')).not.toBe(dimensionOf('ml'));
    expect(dimensionOf('kg')).toBe(dimensionOf('g'));
  });

  it('remonte vers une unité lisible au-delà du millier', () => {
    expect(toDisplayQuantity(1500, 'g')).toEqual({ qty: 1.5, unit: 'kg' });
    expect(toDisplayQuantity(800, 'g')).toEqual({ qty: 800, unit: 'g' });
  });

  it('formate en français, avec accord du pluriel', () => {
    expect(formatQuantity(1500, 'g')).toBe('1,5 kg');
    expect(formatQuantity(2, 'gousse')).toBe('2 gousses');
    expect(formatQuantity(1, 'gousse')).toBe('1 gousse');
    expect(formatQuantity(3, 'piece')).toBe('3');
  });
});

/**
 * Toujours vers le haut : ce qui est acheté doit couvrir ce qui est cuisiné.
 * Manquer 40 g de riz un dimanche après-midi coûte une course.
 */
describe('roundUpQuantity', () => {
  it('monte les masses et les volumes de cinq en cinq', () => {
    expect(roundUpQuantity(225, 'g')).toBe(225);
    expect(roundUpQuantity(226, 'g')).toBe(230);
    expect(roundUpQuantity(221, 'ml')).toBe(225);
  });

  it('ne descend jamais', () => {
    for (const qty of [1, 7, 112.4, 227.5, 999]) {
      expect(roundUpQuantity(qty, 'g')).toBeGreaterThanOrEqual(qty);
    }
  });

  it('monte à l’unité ce qui se compte à la pièce', () => {
    expect(roundUpQuantity(1.5, 'piece')).toBe(2);
    expect(roundUpQuantity(2, 'piece')).toBe(2);
    expect(roundUpQuantity(0.25, 'gousse')).toBe(1);
  });

  it('tolère la demi-cuillerée, qui est un geste réel', () => {
    expect(roundUpQuantity(0.75, 'cas')).toBe(1);
    expect(roundUpQuantity(0.25, 'cac')).toBe(0.5);
    expect(roundUpQuantity(1.5, 'cas')).toBe(1.5);
  });

  /**
   * Le cas qui impose l'epsilon : 300 g mis à l'échelle de 8 vers 6 portions
   * vaut 225.00000000000003 en flottant. Un `ceil` naïf achèterait 230 g.
   */
  it('ne monte pas d’un pas à cause du flottant', () => {
    expect(roundUpQuantity((300 * 6) / 8, 'g')).toBe(225);
    expect(roundUpQuantity((150 * 4) / 6, 'g')).toBe(100);
  });
});
