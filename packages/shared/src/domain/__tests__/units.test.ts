import { describe, expect, it } from 'vitest';
import { dimensionOf, formatQuantity, toBaseQuantity, toDisplayQuantity } from '../units';

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
