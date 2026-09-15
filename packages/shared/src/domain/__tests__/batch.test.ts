import { describe, expect, it } from 'vitest';
import {
  countBatchMealsServing,
  getBatchPortions,
  getBatchSession,
  getThawReminders,
  orderForCooking,
  scaleIngredients,
} from '../batch';
import { makePlan, makeRecipe } from './fixtures';

/**
 * Semaine du samedi 12 septembre 2026 : dimanche 13 est le jour du batch,
 * lundi 14 à vendredi 18 sont nourris par lui.
 */
const WEEK = '2026-09-12';

const curry = makeRecipe({ id: 'curry', name: 'Curry', prepMinutes: 50 });
const chili = makeRecipe({ id: 'chili', name: 'Chili', prepMinutes: 40, tags: ['congelable'] });

const recipesById = new Map([
  [curry.id, curry],
  [chili.id, chili],
]);

/** Curry lundi et mardi, chili jeudi et vendredi. */
function planWithBatch() {
  const portion = (recipeId: string) => ({ recipeId, kind: 'batch-leftover' as const });
  return makePlan(
    [
      {},
      {},
      { lunch: portion('curry'), dinner: portion('curry') },
      { lunch: portion('curry'), dinner: portion('curry') },
      {},
      { lunch: portion('chili'), dinner: portion('chili') },
      { lunch: portion('chili'), dinner: portion('chili') },
    ],
    WEEK,
    ['curry', 'chili'],
  );
}

describe('getBatchSession', () => {
  it('situe la préparation le dimanche, deuxième jour de la semaine', () => {
    expect(getBatchSession(planWithBatch(), recipesById).cookDate).toBe('2026-09-13');
  });

  it('garde l’ordre de préparation déclaré par le plan', () => {
    // C'est l'ordre que le modèle a demandé de suivre : le changer ferait
    // perdre l'enchaînement qu'il a pensé.
    const session = getBatchSession(planWithBatch(), recipesById);
    expect(session.recipes.map((entry) => entry.recipe.id)).toEqual(['curry', 'chili']);
  });

  it('additionne les temps pour dimensionner l’après-midi', () => {
    expect(getBatchSession(planWithBatch(), recipesById).totalMinutes).toBe(90);
  });

  it('relève les jours où chaque plat est servi', () => {
    const session = getBatchSession(planWithBatch(), recipesById);
    expect(session.recipes[0]?.servedDayIndexes).toEqual([2, 3]);
    expect(session.recipes[1]?.servedDayIndexes).toEqual([5, 6]);
  });

  it('signale les plats à congeler, servis en fin de semaine', () => {
    // Cuisiné dimanche, mangé vendredi : cinq jours au frigo.
    const session = getBatchSession(planWithBatch(), recipesById);
    expect(session.recipes[0]?.needsFreezing).toBe(false);
    expect(session.recipes[1]?.needsFreezing).toBe(true);
  });

  it('ignore un plat dont la recette manque, plutôt que d’afficher un vide', () => {
    const plan = makePlan([], WEEK, ['curry', 'disparue']);
    const session = getBatchSession(plan, recipesById);

    expect(session.recipes.map((entry) => entry.recipe.id)).toEqual(['curry']);
  });

  it('rend une session vide pour un plan composé avant le batch', () => {
    const session = getBatchSession(makePlan([], WEEK), recipesById);

    expect(session.recipes).toEqual([]);
    expect(session.totalMinutes).toBe(0);
    expect(session.cookDate).toBe('2026-09-13');
  });

  it('ne compte pas deux fois un plat servi midi et soir le même jour', () => {
    const session = getBatchSession(planWithBatch(), recipesById);
    expect(session.recipes[0]?.servedDayIndexes).toHaveLength(2);
  });
});

/**
 * Le rappel doit tomber le soir où il sert, pas le dimanche.
 *
 * Repères de la semaine du samedi 12 : lundi 14 et mardi 15 servent le curry,
 * mercredi 16 est libre, jeudi 17 et vendredi 18 servent le chili — le seul
 * plat congelable.
 */
describe('getThawReminders', () => {
  const reminders = (today: string) =>
    getThawReminders(planWithBatch(), recipesById, today).map((recipe) => recipe.name);

  it('rappelle le mercredi soir ce qu’on mange jeudi', () => {
    expect(reminders('2026-09-16')).toEqual(['Chili']);
  });

  it('rappelle encore le jeudi soir, pour le vendredi', () => {
    expect(reminders('2026-09-17')).toEqual(['Chili']);
  });

  // Un plat servi mardi sortait du frigo : le congélateur n'a rien à voir là.
  it('ne rappelle rien pour un jour que le frigo couvre', () => {
    expect(reminders('2026-09-14')).toEqual([]);
    expect(reminders('2026-09-15')).toEqual([]);
  });

  it('ne déborde pas sur la semaine suivante', () => {
    // Vendredi est le dernier jour : demain appartient à un autre plan.
    expect(reminders('2026-09-18')).toEqual([]);
  });

  it('ne dit rien d’une date hors de la semaine', () => {
    expect(reminders('2026-10-01')).toEqual([]);
  });

  it('ne nomme un plat qu’une fois, même servi midi et soir', () => {
    // Le chili occupe les deux créneaux du jeudi : on ne sort qu'une barquette
    // de plus, pas deux rappels.
    expect(reminders('2026-09-16')).toHaveLength(1);
  });
});

/**
 * « Ce qui est acheté est ce qui est cuisiné. » Cette fonction est la seule
 * autorité sur les deux, et c'est ce qui rend l'égalité vraie par construction :
 * la liste de courses et l'écran du dimanche l'appellent tous les deux.
 */
describe('getBatchPortions', () => {
  it('compte deux portions par repas servi', () => {
    const plan = makePlan(
      [
        {},
        {},
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
      ],
      '2026-09-12',
      ['curry'],
    );

    expect(countBatchMealsServing(plan, 'curry')).toBe(3);
    expect(getBatchPortions(plan, 'curry')).toBe(6);
  });

  it('ne compte ni le repas dehors ni le reste d’une semaine précédente', () => {
    const plan = makePlan(
      [
        { lunch: { recipeId: 'curry', kind: 'freezer-backup' } },
        { lunch: { recipeId: null, kind: 'eat-out' } },
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
      ],
      '2026-09-12',
      ['curry'],
    );

    // Le `freezer-backup` a été acheté et cuisiné une autre semaine.
    expect(getBatchPortions(plan, 'curry')).toBe(4);
  });

  /**
   * Un plat du batch est cuisiné le dimanche, donc acheté, même si plus aucun
   * créneau ne le sert. L'interface interdit d'en arriver là, mais un plan
   * antérieur à cette règle ne doit pas produire une liste qui oublie un plat.
   */
  it('garde un plancher d’un repas pour un plat que rien ne sert', () => {
    const plan = makePlan([{}], '2026-09-12', ['curry']);
    expect(countBatchMealsServing(plan, 'curry')).toBe(0);
    expect(getBatchPortions(plan, 'curry')).toBe(2);
  });

  it('annonce à la session du dimanche les portions qu’on a achetées', () => {
    const plan = makePlan(
      [
        {},
        {},
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
      ],
      '2026-09-12',
      ['curry'],
    );
    const recipes = new Map([['curry', makeRecipe({ id: 'curry', servings: 8 })]]);

    const session = getBatchSession(plan, recipes);
    // La recette déclare 8 portions, mais elle ne sert plus que deux repas.
    expect(session.recipes[0]?.portions).toBe(4);
  });
});

describe('scaleIngredients', () => {
  const eightPortions = makeRecipe({
    id: 'curry',
    servings: 8,
    ingredients: [
      { name: 'lentilles corail', qty: 400, unit: 'g', aisle: 'epicerie' },
      { name: 'oignon', qty: 3, unit: 'piece', aisle: 'fruits-legumes' },
    ],
  });

  it('rend la recette telle quelle quand on cuisine ses portions', () => {
    expect(scaleIngredients(eightPortions, 8)).toBe(eightPortions.ingredients);
  });

  it('met les quantités à l’échelle, arrondies vers le haut comme les courses', () => {
    const six = scaleIngredients(eightPortions, 6);
    expect(six[0]?.qty).toBe(300);
    // 2,25 oignons : on en sort 3, jamais 2.
    expect(six[1]?.qty).toBe(3);
  });
});

describe('orderForCooking', () => {
  const entry = (id: string, cookMinutes: number, prepMinutes = 20) => ({
    recipe: makeRecipe({ id, cookMinutes, prepMinutes }),
  });

  it('lance d’abord le plat qui cuit le plus longtemps', () => {
    const ordered = orderForCooking([
      entry('salade', 0),
      entry('bourguignon', 150),
      entry('chili', 40),
    ]);
    expect(ordered.map((item) => item.recipe.id)).toEqual(['bourguignon', 'chili', 'salade']);
  });

  it('départage par le temps de préparation, puis par l’ordre du batch', () => {
    const ordered = orderForCooking([entry('a', 30, 10), entry('b', 30, 40), entry('c', 30, 10)]);
    expect(ordered.map((item) => item.recipe.id)).toEqual(['b', 'a', 'c']);
  });
});
