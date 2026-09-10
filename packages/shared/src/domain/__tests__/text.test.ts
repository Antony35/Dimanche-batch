import { describe, expect, it } from 'vitest';
import { capitalize, normalizeName } from '../text';

describe('capitalize', () => {
  it('met la première lettre en majuscule sans toucher au reste', () => {
    expect(capitalize('curry de lentilles')).toBe('Curry de lentilles');
    expect(capitalize('œufs cocotte')).toBe('Œufs cocotte');
  });

  it('supporte la chaîne vide', () => {
    expect(capitalize('')).toBe('');
  });
});

/**
 * `normalizeName` sert deux usages qui n'ont pas droit à l'erreur : la clé
 * d'agrégation des courses, et la comparaison d'un plat banni. Dans les deux
 * cas, deux écritures du même nom doivent tomber sur la même valeur.
 */
describe('normalizeName', () => {
  it('ignore la casse, les accents et les espaces en trop', () => {
    expect(normalizeName('  Curry   de   Lentilles Corail ')).toBe('curry de lentilles corail');
    expect(normalizeName('Bœuf Bourguignon')).toBe('bœuf bourguignon');
    expect(normalizeName('Crème brûlée')).toBe('creme brulee');
    expect(normalizeName('Poêlée de légumes')).toBe('poelee de legumes');
  });

  it('fait tomber sur la même valeur deux écritures du même plat', () => {
    expect(normalizeName('Curry de Lentilles')).toBe(normalizeName('curry de lentilles'));
    expect(normalizeName('Tajine d’agneau')).toBe(normalizeName('TAJINE D’AGNEAU'));
  });

  // Une égalité, pas un rapprochement : un validateur flou refuserait des
  // recettes légitimes et coûterait une reprise au foyer.
  it('garde distincts deux noms seulement voisins', () => {
    expect(normalizeName('Curry de lentilles')).not.toBe(normalizeName('Curry de pois chiches'));
    expect(normalizeName('Soupe de poireaux')).not.toBe(normalizeName('Soupe de poireaux au lard'));
  });
});
