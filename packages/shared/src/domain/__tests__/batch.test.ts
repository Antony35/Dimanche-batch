import { describe, expect, it } from 'vitest';
import { getBatchSession } from '../batch';
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
