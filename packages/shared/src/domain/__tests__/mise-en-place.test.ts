import { describe, expect, it } from 'vitest';
import { getSharedIngredients, ingredientsForStep } from '../mise-en-place';
import { makeRecipe } from './fixtures';

/**
 * Une fois tout coupé d'un coup, il faut répartir. Ces tests fixent ce qui ne
 * pardonne pas : la part de chaque plat doit être exacte, et deux unités
 * incompatibles ne doivent jamais s'additionner.
 */
const ingredient = (name: string, qty: number, unit: 'g' | 'kg' | 'piece') => ({
  name,
  qty,
  unit,
  aisle: 'fruits-legumes' as const,
});

const curry = makeRecipe({
  id: 'curry',
  name: 'Curry',
  ingredients: [ingredient('carotte', 2, 'piece'), ingredient('oignon', 1, 'piece')],
});
const chili = makeRecipe({
  id: 'chili',
  name: 'Chili',
  ingredients: [ingredient('carotte', 3, 'piece'), ingredient('Oignon', 2, 'piece')],
});

describe('getSharedIngredients', () => {
  it('additionne le total et garde la part de chaque plat', () => {
    const carotte = getSharedIngredients([curry, chili]).find((entry) => entry.name === 'carotte');

    expect(carotte?.total).toEqual({ qty: 5, unit: 'piece' });
    expect(carotte?.shares).toEqual([
      { recipeId: 'curry', qty: 2, unit: 'piece' },
      { recipeId: 'chili', qty: 3, unit: 'piece' },
    ]);
  });

  it('reconnaît un ingrédient malgré la casse', () => {
    const oignon = getSharedIngredients([curry, chili]).find(
      (entry) => entry.name.toLowerCase() === 'oignon',
    );
    expect(oignon?.total.qty).toBe(3);
  });

  it('ramène les masses à la même unité', () => {
    const a = makeRecipe({ id: 'a', ingredients: [ingredient('riz', 200, 'g')] });
    const b = makeRecipe({ id: 'b', ingredients: [ingredient('riz', 0.3, 'kg')] });

    expect(getSharedIngredients([a, b])[0]?.total).toEqual({ qty: 500, unit: 'g' });
  });

  // Des grammes et des pièces du même légume : deux lignes, comme sur la liste
  // de courses. Les additionner produirait un nombre sans unité ni sens.
  it('n’additionne jamais deux dimensions différentes', () => {
    const a = makeRecipe({ id: 'a', ingredients: [ingredient('carotte', 200, 'g')] });
    const b = makeRecipe({ id: 'b', ingredients: [ingredient('carotte', 3, 'piece')] });

    expect(getSharedIngredients([a, b])).toEqual([]);
  });

  it('ignore ce qu’un seul plat utilise', () => {
    const a = makeRecipe({ id: 'a', ingredients: [ingredient('poivron', 1, 'piece')] });
    const b = makeRecipe({ id: 'b', ingredients: [ingredient('courge', 1, 'piece')] });

    expect(getSharedIngredients([a, b])).toEqual([]);
  });

  it('compte une fois par plat un ingrédient cité deux fois dans la même recette', () => {
    const a = makeRecipe({
      id: 'a',
      ingredients: [ingredient('ail', 1, 'piece'), ingredient('ail', 1, 'piece')],
    });
    const b = makeRecipe({ id: 'b', ingredients: [ingredient('ail', 2, 'piece')] });

    expect(getSharedIngredients([a, b])[0]?.shares).toEqual([
      { recipeId: 'a', qty: 2, unit: 'piece' },
      { recipeId: 'b', qty: 2, unit: 'piece' },
    ]);
  });
});

describe('ingredientsForStep', () => {
  const shared = getSharedIngredients([curry, chili]);
  const names = (text: string, recipeIds = ['curry', 'chili']) =>
    ingredientsForStep({ text, recipeIds }, shared).map((entry) => entry.name.toLowerCase());

  it('donne le partage des ingrédients que l’étape nomme, au pluriel compris', () => {
    expect(names('Éplucher les carottes des deux plats.')).toEqual(['carotte']);
  });

  it('n’affiche rien sous une étape qui ne concerne qu’un plat', () => {
    expect(names('Éplucher les carottes.', ['curry'])).toEqual([]);
  });

  it('n’affiche rien sous une étape qui ne nomme aucun ingrédient partagé', () => {
    expect(names('Lancer les deux cuissons.')).toEqual([]);
  });

  it('restreint le partage aux plats de l’étape', () => {
    const soupe = makeRecipe({
      id: 'soupe',
      ingredients: [ingredient('carotte', 4, 'piece')],
    });
    const trio = getSharedIngredients([curry, chili, soupe]);
    const [carotte] = ingredientsForStep(
      { text: 'Éplucher les carottes du curry et du chili.', recipeIds: ['curry', 'chili'] },
      trio,
    );

    expect(carotte?.total.qty).toBe(5);
    expect(carotte?.shares.map((share) => share.recipeId)).toEqual(['curry', 'chili']);
  });

  it('reconnaît un nom composé au pluriel', () => {
    const a = makeRecipe({ id: 'a', ingredients: [ingredient('pomme de terre', 2, 'piece')] });
    const b = makeRecipe({ id: 'b', ingredients: [ingredient('pomme de terre', 3, 'piece')] });

    const [entry] = ingredientsForStep(
      { text: 'Éplucher toutes les pommes de terre.', recipeIds: ['a', 'b'] },
      getSharedIngredients([a, b]),
    );
    expect(entry?.total.qty).toBe(5);
  });
});
