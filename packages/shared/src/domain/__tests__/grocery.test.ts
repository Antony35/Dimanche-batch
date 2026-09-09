import { describe, expect, it } from 'vitest';
import {
  buildGroceryList,
  groupByAisle,
  mergePreservingChecked,
  normalizeIngredientName,
} from '../grocery';
import { formatGroceryListForSharing } from '../grocery-export';
import { makePlan, makeRecipe } from './fixtures';
import type { GroceryItem } from '../../schemas/grocery-list';

describe('normalizeIngredientName', () => {
  it('efface la casse, les accents et les espaces superflus', () => {
    expect(normalizeIngredientName('  Oignon   Rouge ')).toBe('oignon rouge');
    expect(normalizeIngredientName('Céleri')).toBe('celeri');
    expect(normalizeIngredientName('Œuf')).toBe('œuf');
  });
});

describe('buildGroceryList', () => {
  const curry = makeRecipe({
    id: 'curry',
    ingredients: [
      { name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' },
      { name: 'Oignon', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
    ],
  });
  const soupe = makeRecipe({
    id: 'soupe',
    ingredients: [
      { name: 'oignon', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
      { name: 'lait de coco', qty: 40, unit: 'cl', aisle: 'epicerie' },
    ],
  });

  it('ignore les repas issus du batch pour ne pas acheter en double', () => {
    const plan = makePlan([
      { lunch: { recipeId: 'curry', kind: 'batch-leftover' }, dinner: { recipeId: 'curry', kind: 'cooked' } },
      { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
    ]);

    const items = buildGroceryList(plan, [curry]);
    const lentilles = items.find((item) => item.name === 'lentilles corail');
    expect(lentilles?.qty).toBe(250);
  });

  it('additionne un même ingrédient venu de deux recettes', () => {
    const plan = makePlan([
      { dinner: { recipeId: 'curry', kind: 'cooked' } },
      { dinner: { recipeId: 'soupe', kind: 'cooked' } },
    ]);

    const items = buildGroceryList(plan, [curry, soupe]);
    const oignon = items.find((item) => item.name === 'oignon');
    expect(oignon?.qty).toBe(3);
    expect(oignon?.fromRecipeIds).toEqual(['curry', 'soupe']);
  });

  it('convertit avant d’additionner des unités de même dimension', () => {
    const grandCurry = makeRecipe({
      id: 'grand-curry',
      ingredients: [{ name: 'lait de coco', qty: 200, unit: 'ml', aisle: 'epicerie' }],
    });
    const plan = makePlan([
      { dinner: { recipeId: 'soupe', kind: 'cooked' } },
      { dinner: { recipeId: 'grand-curry', kind: 'cooked' } },
    ]);

    const items = buildGroceryList(plan, [soupe, grandCurry]);
    const coco = items.find((item) => item.name === 'lait de coco');
    expect(coco).toMatchObject({ qty: 600, unit: 'ml' });
  });

  it('compte deux fois une recette réellement cuisinée deux fois', () => {
    const plan = makePlan([
      { dinner: { recipeId: 'curry', kind: 'cooked' } },
      {},
      { dinner: { recipeId: 'curry', kind: 'cooked' } },
    ]);

    const items = buildGroceryList(plan, [curry]);
    expect(items.find((item) => item.name === 'lentilles corail')?.qty).toBe(500);
  });

  it('trie par ordre de parcours du magasin', () => {
    const plan = makePlan([{ dinner: { recipeId: 'curry', kind: 'cooked' } }]);
    const items = buildGroceryList(plan, [curry]);
    expect(items.map((item) => item.aisle)).toEqual(['fruits-legumes', 'epicerie']);
  });

  it('ignore une référence vers une recette absente sans planter', () => {
    const plan = makePlan([{ dinner: { recipeId: 'inconnue', kind: 'cooked' } }]);
    expect(buildGroceryList(plan, [curry])).toEqual([]);
  });
});

describe('mergePreservingChecked', () => {
  it('conserve les cases cochées lors d’une régénération', () => {
    const previous = [
      { id: 'oignon--piece', name: 'oignon', qty: 2, unit: 'piece' as const, aisle: 'fruits-legumes' as const, checked: true, fromRecipeIds: ['curry'] },
    ];
    const next = [
      { id: 'oignon--piece', name: 'oignon', qty: 5, unit: 'piece' as const, aisle: 'fruits-legumes' as const, checked: false, fromRecipeIds: ['curry', 'soupe'] },
      { id: 'riz--mass', name: 'riz', qty: 300, unit: 'g' as const, aisle: 'epicerie' as const, checked: false, fromRecipeIds: ['soupe'] },
    ];

    const merged = mergePreservingChecked(next, previous);
    expect(merged[0]?.checked).toBe(true);
    expect(merged[0]?.qty).toBe(5);
    expect(merged[1]?.checked).toBe(false);
  });
});

describe('formatGroceryListForSharing', () => {
  const items = [
    { id: 'oignon--piece', name: 'oignon', qty: 3, unit: 'piece' as const, aisle: 'fruits-legumes' as const, checked: false, fromRecipeIds: [] },
    { id: 'riz--mass', name: 'riz', qty: 1500, unit: 'g' as const, aisle: 'epicerie' as const, checked: false, fromRecipeIds: [] },
    { id: 'sel--mass', name: 'sel', qty: 10, unit: 'g' as const, aisle: 'epicerie' as const, checked: true, fromRecipeIds: [] },
  ];

  it('groupe par rayon et exclut les articles déjà cochés', () => {
    const text = formatGroceryListForSharing(items);
    expect(text).toContain('FRUITS & LÉGUMES');
    expect(text).toContain('Oignon 3');
    expect(text).toContain('Riz 1,5 kg');
    expect(text).not.toContain('Sel');
  });

  it('rend une chaîne vide quand tout est coché', () => {
    const allChecked = items.map((item) => ({ ...item, checked: true }));
    expect(formatGroceryListForSharing(allChecked)).toBe('');
  });
});

describe('groupByAisle', () => {
  const item = (id: string, aisle: GroceryItem['aisle'], name = id): GroceryItem => ({
    id,
    name,
    qty: 1,
    unit: 'piece',
    aisle,
    checked: false,
    fromRecipeIds: ['r1'],
  });

  it('rend les rayons dans l’ordre de parcours du magasin', () => {
    const groups = groupByAisle([
      item('riz', 'epicerie'),
      item('poireaux', 'fruits-legumes'),
      item('lait', 'cremerie'),
    ]);

    // Ni l’ordre d’entrée ni l’ordre alphabétique : celui d’AISLES.
    expect(groups.map((group) => group.aisle)).toEqual([
      'fruits-legumes',
      'cremerie',
      'epicerie',
    ]);
  });

  it('réunit dans un seul groupe les articles d’un même rayon, triés par nom', () => {
    const groups = groupByAisle([
      item('tomates', 'fruits-legumes'),
      item('carottes', 'fruits-legumes'),
      item('lait', 'cremerie'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((entry) => entry.name)).toEqual(['carottes', 'tomates']);
  });

  it('n’invente pas de rayon vide', () => {
    expect(groupByAisle([])).toEqual([]);
    expect(groupByAisle([item('riz', 'epicerie')]).map((group) => group.aisle)).toEqual([
      'epicerie',
    ]);
  });
});

describe('formatGroceryListForSharing, cas limites', () => {
  const item = (name: string, checked: boolean): GroceryItem => ({
    id: name,
    name,
    qty: 2,
    unit: 'piece',
    aisle: 'fruits-legumes',
    checked,
    fromRecipeIds: ['r1'],
  });

  it('ne rend que le titre quand tout est coché', () => {
    // L’écran désactive le partage dans ce cas ; le test fixe malgré tout ce
    // que le domaine renvoie, pour qu’un appelant futur ne le découvre pas.
    expect(formatGroceryListForSharing([item('tomate', true)], { title: 'Courses' })).toBe(
      'Courses',
    );
  });

  it('met une majuscule au nom et garde la quantité sur la même ligne', () => {
    // `piece` n’a volontairement pas de libellé : on écrit « Tomate 2 », pas
    // « Tomate 2 pièces ». Une unité nommée, elle, apparaît.
    expect(
      formatGroceryListForSharing([item('tomate', false)], { includeAisleHeaders: false }),
    ).toBe('Tomate 2');

    expect(
      formatGroceryListForSharing([{ ...item('ail', false), unit: 'gousse' }], {
        includeAisleHeaders: false,
      }),
    ).toBe('Ail 2 gousses');
  });

  it('peut inclure les articles déjà cochés à la demande', () => {
    const text = formatGroceryListForSharing([item('tomate', true)], {
      includeChecked: true,
      includeAisleHeaders: false,
    });
    expect(text).toBe('Tomate 2');
  });
});
