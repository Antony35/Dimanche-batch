import { describe, expect, it } from 'vitest';
import {
  buildGroceryList,
  groupByAisle,
  isManualItemId,
  manualItemId,
  mergeGroceryLists,
  normalizeIngredientName,
} from '../grocery';
import { makePlan, makeRecipe } from './fixtures';
import type { GroceryItem } from '../../schemas/grocery-list';

/** Article de courses minimal, pour les fonctions qui en prennent en entrée. */
function makeItem(overrides: Partial<GroceryItem> & Pick<GroceryItem, 'id'>): GroceryItem {
  return {
    name: overrides.id,
    qty: 1,
    unit: 'piece',
    aisle: 'fruits-legumes',
    checked: false,
    origin: 'batch',
    fromRecipeIds: ['r1'],
    ...overrides,
  };
}

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

  it('compte deux fois un plat frais réellement cuisiné deux fois', () => {
    const plan = makePlan([
      { dinner: { recipeId: 'curry', kind: 'cooked' } },
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

/**
 * L'invariant du fichier : **ce qui est acheté est ce qui est cuisiné**.
 *
 * Avant, chaque plat du batch était acheté une fois aux portions que le modèle
 * avait déclarées. Retirer un repas de la semaine ne changeait donc rien à la
 * liste : on achetait pour huit un plat qu'on ne servait plus que six fois.
 */
describe('buildGroceryList, au prorata de ce qui est cuisiné', () => {
  /** Conçu pour quatre repas : 8 portions, 400 g de lentilles. */
  const curry = makeRecipe({
    id: 'curry',
    servings: 8,
    ingredients: [{ name: 'lentilles corail', qty: 400, unit: 'g', aisle: 'epicerie' }],
  });

  function weekServing(meals: number) {
    const days: Array<{ lunch?: { recipeId: string; kind: 'batch-leftover' } }> = [];
    // Les deux premiers jours sont le samedi et le dimanche : on commence lundi.
    for (let index = 0; index < meals; index += 1) {
      days[2 + index] = { lunch: { recipeId: 'curry', kind: 'batch-leftover' } };
    }
    return makePlan(days, '2026-09-12', ['curry']);
  }

  it('achète exactement ce que les repas servis demandent', () => {
    expect(buildGroceryList(weekServing(4), [curry])[0]?.qty).toBe(400);
    expect(buildGroceryList(weekServing(3), [curry])[0]?.qty).toBe(300);
    expect(buildGroceryList(weekServing(2), [curry])[0]?.qty).toBe(200);
  });

  it('allège les courses quand un repas passe au reste de la semaine précédente', () => {
    const before = buildGroceryList(weekServing(4), [curry])[0]?.qty ?? 0;

    const plan = weekServing(4);
    const monday = plan.days[2];
    if (monday) {
      monday.lunch = { ...monday.lunch, recipeId: 'curry-passe', kind: 'freezer-backup' };
    }

    // Le reste a été acheté et cuisiné une autre semaine : il n'achète rien ici.
    expect(buildGroceryList(plan, [curry])[0]?.qty).toBeLessThan(before);
    expect(buildGroceryList(plan, [curry])[0]?.qty).toBe(300);
  });

  it('n’achète rien pour un repas pris à l’extérieur', () => {
    const plan = weekServing(3);
    const tuesday = plan.days[3];
    if (tuesday) tuesday.dinner = { ...tuesday.dinner, recipeId: null, kind: 'eat-out' };

    expect(buildGroceryList(plan, [curry])[0]?.qty).toBe(300);
  });

  /**
   * Un plat du batch est cuisiné le dimanche, donc acheté, même si plus aucun
   * créneau ne le sert. L'interface interdit d'en arriver là — on remplace le
   * plat plutôt que de le vider — mais la liste ne doit jamais oublier un plat
   * entier en silence.
   */
  it('garde un plancher d’un repas pour un plat que rien ne sert', () => {
    const plan = makePlan([], '2026-09-12', ['curry']);
    expect(buildGroceryList(plan, [curry])[0]?.qty).toBe(100);
  });

  /**
   * L'arrondi a lieu une seule fois, sur le total. Arrondir chaque recette
   * avant de les additionner empilerait un demi-pas par recette.
   */
  it('n’arrondit qu’une fois, sur le total agrégé', () => {
    // Deux plats à 150 g pour 8 portions, servis 3 repas chacun : 112,5 g
    // chacun. Arrondis séparément : 115 + 115 = 230. Arrondi une fois : 225.
    const recipes = ['un', 'deux'].map((id) =>
      makeRecipe({
        id,
        servings: 8,
        ingredients: [{ name: 'riz', qty: 150, unit: 'g', aisle: 'epicerie' }],
      }),
    );
    const plan = makePlan(
      [
        {},
        {},
        {
          lunch: { recipeId: 'un', kind: 'batch-leftover' },
          dinner: { recipeId: 'deux', kind: 'batch-leftover' },
        },
        {
          lunch: { recipeId: 'un', kind: 'batch-leftover' },
          dinner: { recipeId: 'deux', kind: 'batch-leftover' },
        },
        {
          lunch: { recipeId: 'un', kind: 'batch-leftover' },
          dinner: { recipeId: 'deux', kind: 'batch-leftover' },
        },
      ],
      '2026-09-12',
      ['un', 'deux'],
    );

    expect(buildGroceryList(plan, recipes)[0]?.qty).toBe(225);
  });

  it('arrondit toujours vers le haut : on ne manque jamais en cuisinant', () => {
    const recipe = makeRecipe({
      id: 'curry',
      servings: 8,
      ingredients: [{ name: 'riz', qty: 310, unit: 'g', aisle: 'epicerie' }],
    });
    // 310 g conçus pour 8 portions, ramenés à 3 repas : 232,5 g. On achète 235,
    // jamais 230 — il manquerait de quoi finir le plat.
    const plan = makePlan(
      [
        {},
        {},
        {
          lunch: { recipeId: 'curry', kind: 'batch-leftover' },
          dinner: { recipeId: 'curry', kind: 'batch-leftover' },
        },
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
      ],
      '2026-09-12',
      ['curry'],
    );

    expect(buildGroceryList(plan, [recipe])[0]?.qty).toBe(235);
  });

  it('ne réécrit jamais la recette, dont le document sert l’historique', () => {
    const plan = weekServing(2);
    buildGroceryList(plan, [curry]);
    expect(curry.servings).toBe(8);
    expect(curry.ingredients[0]?.qty).toBe(400);
  });
});

describe('buildGroceryList, origine des articles', () => {
  const curry = makeRecipe({
    id: 'curry',
    servings: 8,
    ingredients: [
      { name: 'lentilles corail', qty: 400, unit: 'g', aisle: 'epicerie' },
      { name: 'oignon', qty: 4, unit: 'piece', aisle: 'fruits-legumes' },
    ],
  });
  const gratin = makeRecipe({
    id: 'gratin',
    ingredients: [
      { name: 'courgette', qty: 3, unit: 'piece', aisle: 'fruits-legumes' },
      { name: 'oignon', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
    ],
  });

  const plan = makePlan(
    [
      { dinner: { recipeId: 'gratin', kind: 'cooked' } },
      {},
      {
        lunch: { recipeId: 'curry', kind: 'batch-leftover' },
        dinner: { recipeId: 'curry', kind: 'batch-leftover' },
      },
      {
        lunch: { recipeId: 'curry', kind: 'batch-leftover' },
        dinner: { recipeId: 'curry', kind: 'batch-leftover' },
      },
    ],
    '2026-09-12',
    ['curry'],
  );

  it('distingue ce qui vient du batch de ce qui se cuisine frais', () => {
    const items = buildGroceryList(plan, [curry, gratin]);
    expect(items.find((item) => item.name === 'lentilles corail')?.origin).toBe('batch');
    expect(items.find((item) => item.name === 'courgette')?.origin).toBe('fresh');
  });

  it('fait gagner le batch quand un article vient des deux', () => {
    const items = buildGroceryList(plan, [curry, gratin]);
    const oignon = items.find((item) => item.name === 'oignon');
    expect(oignon?.origin).toBe('batch');
    expect(oignon?.fromRecipeIds).toEqual(['curry', 'gratin']);
  });

  it('ne compte pas deux fois un plat du batch marqué cuisiné', () => {
    // Un plan édité repas par repas peut produire ce cas : le plat est déjà
    // acheté au titre du batch, il ne doit pas coûter le double. Il ne sert
    // alors aucune portion, donc le plancher d'un repas s'applique.
    const edited = makePlan([{ dinner: { recipeId: 'curry', kind: 'cooked' } }], '2026-09-12', [
      'curry',
    ]);

    const items = buildGroceryList(edited, [curry]);
    expect(items.filter((item) => item.name === 'lentilles corail')).toHaveLength(1);
    expect(items.find((item) => item.name === 'lentilles corail')?.qty).toBe(100);
  });

  it('ignore un plat du batch dont la recette n’est pas fournie, sans planter', () => {
    const incomplete = makePlan([], '2026-09-12', ['curry', 'inconnue']);
    expect(buildGroceryList(incomplete, [curry])).toHaveLength(2);
  });

  it('rend une liste vide pour une semaine sans batch ni plat cuisiné', () => {
    expect(buildGroceryList(makePlan([]), [curry])).toEqual([]);
  });
});

describe('articles ajoutés à la main', () => {
  it('vit dans son propre espace de noms, sans collision possible', () => {
    const manual = manualItemId('Courgette', 'piece');
    expect(isManualItemId(manual)).toBe(true);
    expect(manual).not.toBe('courgette--piece');
    // Deux ajouts du même article mettent la ligne à jour au lieu de la doubler.
    expect(manualItemId('courgettes ', 'piece')).not.toBe(manual);
    expect(manualItemId('Courgette', 'piece')).toBe(manual);
    expect(isManualItemId('courgette--piece')).toBe(false);
  });
});

describe('mergeGroceryLists', () => {
  it('conserve les cases cochées lors d’un recalcul', () => {
    const previous = [makeItem({ id: 'oignon--piece', name: 'oignon', qty: 2, checked: true })];
    const next = [
      makeItem({ id: 'oignon--piece', name: 'oignon', qty: 5 }),
      makeItem({ id: 'riz--mass', name: 'riz', qty: 300, unit: 'g', aisle: 'epicerie' }),
    ];

    const merged = mergeGroceryLists(next, previous);
    expect(merged.find((item) => item.id === 'oignon--piece')).toMatchObject({
      checked: true,
      qty: 5,
    });
    expect(merged.find((item) => item.id === 'riz--mass')?.checked).toBe(false);
  });

  /**
   * Le recalcul est intégral à chaque modification d'un repas, et l'écrivain
   * supprime tout article absent de la liste qu'on lui rend. Sans ce report,
   * poser un repas le samedi effacerait le sac poubelle.
   */
  it('reporte les articles ajoutés à la main, qu’aucun recalcul ne reproduit', () => {
    const sacPoubelle = makeItem({
      id: manualItemId('sac poubelle', 'piece'),
      name: 'sac poubelle',
      aisle: 'entretien',
      origin: 'manual',
      checked: true,
      fromRecipeIds: [],
    });
    const previous = [makeItem({ id: 'oignon--piece', name: 'oignon' }), sacPoubelle];
    const next = [makeItem({ id: 'oignon--piece', name: 'oignon', qty: 4 })];

    const merged = mergeGroceryLists(next, previous);
    const kept = merged.find((item) => item.id === sacPoubelle.id);
    expect(kept).toBeDefined();
    expect(kept?.checked).toBe(true);
    expect(kept?.origin).toBe('manual');
  });

  it('ne reporte pas un article calculé qui a disparu du plan', () => {
    const previous = [makeItem({ id: 'oignon--piece', name: 'oignon', checked: true })];
    expect(mergeGroceryLists([], previous)).toEqual([]);
  });

  it('rend la liste triée par ordre de parcours du magasin', () => {
    const previous = [
      makeItem({
        id: manualItemId('sac poubelle', 'piece'),
        name: 'sac poubelle',
        aisle: 'entretien',
        origin: 'manual',
      }),
    ];
    const next = [makeItem({ id: 'oignon--piece', name: 'oignon' })];

    expect(mergeGroceryLists(next, previous).map((item) => item.aisle)).toEqual([
      'fruits-legumes',
      'entretien',
    ]);
  });
});

describe('groupByAisle', () => {
  it('rend les rayons dans l’ordre de parcours du magasin', () => {
    const groups = groupByAisle([
      makeItem({ id: 'riz', aisle: 'epicerie' }),
      makeItem({ id: 'poireaux', aisle: 'fruits-legumes' }),
      makeItem({ id: 'lait', aisle: 'cremerie' }),
      makeItem({ id: 'sac poubelle', aisle: 'entretien' }),
    ]);

    // Ni l’ordre d’entrée ni l’ordre alphabétique : celui d’AISLES.
    expect(groups.map((group) => group.aisle)).toEqual([
      'fruits-legumes',
      'cremerie',
      'epicerie',
      'entretien',
    ]);
  });

  it('réunit dans un seul groupe les articles d’un même rayon, triés par nom', () => {
    const groups = groupByAisle([
      makeItem({ id: 'tomates', aisle: 'fruits-legumes' }),
      makeItem({ id: 'carottes', aisle: 'fruits-legumes' }),
      makeItem({ id: 'lait', aisle: 'cremerie' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((entry) => entry.name)).toEqual(['carottes', 'tomates']);
  });

  it('n’invente pas de rayon vide', () => {
    expect(groupByAisle([])).toEqual([]);
    expect(groupByAisle([makeItem({ id: 'riz', aisle: 'epicerie' })]).map((g) => g.aisle)).toEqual([
      'epicerie',
    ]);
  });
});
