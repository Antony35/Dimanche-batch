import { describe, expect, it } from 'vitest';
import {
  BatchRecipeNotFoundError,
  MealNotFoundError,
  collectRecipeIds,
  countMealsServing,
  findMeal,
  replaceBatchRecipeInPlan,
  replaceMealInPlan,
} from '../plan-edit';
import { makeMeal, makePlan } from './fixtures';

const WEEK = '2026-09-14';
const MARDI = '2026-09-15';

function planWithTwoRecipes() {
  return makePlan(
    [
      {
        lunch: { recipeId: 'batch', kind: 'batch-leftover' },
        dinner: { recipeId: 'soupe', kind: 'cooked' },
      },
      {
        lunch: { recipeId: 'batch', kind: 'batch-leftover' },
        dinner: { recipeId: 'soupe', kind: 'cooked' },
      },
    ],
    WEEK,
  );
}

describe('replaceMealInPlan', () => {
  it('ne modifie que le créneau visé', () => {
    const plan = planWithTwoRecipes();
    const next = replaceMealInPlan(
      plan,
      MARDI,
      'dinner',
      makeMeal({ recipeId: 'chili', kind: 'cooked' }),
    );

    expect(findMeal(next, MARDI, 'dinner')?.recipeId).toBe('chili');
    expect(findMeal(next, MARDI, 'lunch')?.recipeId).toBe('batch');
    expect(findMeal(next, WEEK, 'dinner')?.recipeId).toBe('soupe');
  });

  it('ne mute pas le plan d’origine', () => {
    // Le plan vient d’un snapshot Firestore : le muter fausserait la
    // comparaison avec ce qui est réellement en base.
    const plan = planWithTwoRecipes();
    replaceMealInPlan(plan, MARDI, 'dinner', makeMeal({ recipeId: 'chili', kind: 'cooked' }));

    expect(findMeal(plan, MARDI, 'dinner')?.recipeId).toBe('soupe');
  });

  it('retire des `recipeIds` une recette qui n’est plus servie nulle part', () => {
    const plan = makePlan([{ dinner: { recipeId: 'soupe', kind: 'cooked' } }], WEEK);
    const next = replaceMealInPlan(
      plan,
      WEEK,
      'dinner',
      makeMeal({ recipeId: 'chili', kind: 'cooked' }),
    );

    expect(next.recipeIds).toEqual(['chili']);
  });

  it('garde une recette encore servie un autre jour', () => {
    // Remplacer le mardi ne doit pas décrocher `soupe` : elle reste au menu
    // du lundi, et la requête qui charge les recettes du plan en dépend.
    const plan = planWithTwoRecipes();
    const next = replaceMealInPlan(
      plan,
      MARDI,
      'dinner',
      makeMeal({ recipeId: 'chili', kind: 'cooked' }),
    );

    expect(next.recipeIds).toContain('soupe');
    expect(next.recipeIds).toContain('chili');
    expect(next.recipeIds).toContain('batch');
  });

  it('refuse une date absente du plan', () => {
    expect(() =>
      replaceMealInPlan(planWithTwoRecipes(), '2026-10-01', 'dinner', makeMeal()),
    ).toThrow(MealNotFoundError);
  });
});

describe('collectRecipeIds', () => {
  it('dédoublonne et ignore les repas sans recette', () => {
    const plan = planWithTwoRecipes();
    expect(collectRecipeIds(plan.days)).toEqual(['batch', 'soupe']);
  });

  it('rend une liste vide pour une semaine entièrement prise dehors', () => {
    expect(collectRecipeIds(makePlan([]).days)).toEqual([]);
  });
});

describe('findMeal', () => {
  it('rend `null` plutôt que de lever pour une date inconnue', () => {
    expect(findMeal(planWithTwoRecipes(), '2026-10-01', 'lunch')).toBeNull();
  });
});

describe('replaceMealInPlan, invariant du batch', () => {
  it('garde un plat du batch dans `recipeIds` même quand plus aucun repas ne le sert', () => {
    // Le plat est cuisiné le dimanche : il est acheté et préparé. Le sortir de
    // `recipeIds` ferait disparaître ses ingrédients de la liste de courses.
    const plan = makePlan([{ dinner: { recipeId: 'batch', kind: 'batch-leftover' } }], WEEK, [
      'batch',
    ]);

    const next = replaceMealInPlan(
      plan,
      WEEK,
      'dinner',
      makeMeal({ recipeId: 'chili', kind: 'cooked' }),
    );

    expect(next.recipeIds).toContain('batch');
    expect(next.recipeIds).toContain('chili');
  });

  it('ne duplique pas un plat du batch également servi par un repas', () => {
    const plan = makePlan([{ lunch: { recipeId: 'batch', kind: 'batch-leftover' } }], WEEK, [
      'batch',
    ]);

    const next = replaceMealInPlan(
      plan,
      WEEK,
      'dinner',
      makeMeal({ recipeId: 'batch', kind: 'batch-leftover' }),
    );

    expect(next.recipeIds.filter((id) => id === 'batch')).toHaveLength(1);
  });
});

/**
 * Remplacer un plat du batch touche tout ce qu'il servait d'un coup. Ce que ces
 * tests protègent n'est pas le remplacement lui-même — trivial — mais l'ordre
 * dans lequel il se fait : si l'ancien plat reste dans `batchRecipeIds`, il
 * reste dans `recipeIds`, et la liste de courses continue de l'acheter.
 */
describe('replaceBatchRecipeInPlan', () => {
  const portion = (recipeId: string) => ({ recipeId, kind: 'batch-leftover' as const });

  /** Curry lundi midi et soir, chili mardi midi. */
  function planWithBatch() {
    return makePlan(
      [
        {},
        {},
        { lunch: portion('curry'), dinner: portion('curry') },
        { lunch: portion('chili') },
        {},
        {},
        {},
      ],
      '2026-09-12',
      ['curry', 'chili'],
    );
  }

  it('remplace le plat sur tous les repas qu’il servait', () => {
    const next = replaceBatchRecipeInPlan(planWithBatch(), 'curry', 'tajine');

    expect(next.days[2]?.lunch.recipeId).toBe('tajine');
    expect(next.days[2]?.dinner.recipeId).toBe('tajine');
    // Le chili n'a pas bougé.
    expect(next.days[3]?.lunch.recipeId).toBe('chili');
  });

  it('laisse les repas dans leur nature de portion', () => {
    const next = replaceBatchRecipeInPlan(planWithBatch(), 'curry', 'tajine');
    expect(next.days[2]?.lunch.kind).toBe('batch-leftover');
  });

  it('garde la position du plat dans l’ordre de préparation', () => {
    // C'est cet ordre que suit l'écran du dimanche : le remplaçant prend la
    // place de celui qu'il remplace, pas la fin de la liste.
    const next = replaceBatchRecipeInPlan(planWithBatch(), 'curry', 'tajine');
    expect(next.batchRecipeIds).toEqual(['tajine', 'chili']);
  });

  // L'invariant central de ce lot.
  it('sort l’ancien plat de recipeIds, donc de la liste de courses', () => {
    const next = replaceBatchRecipeInPlan(planWithBatch(), 'curry', 'tajine');

    expect(next.recipeIds).not.toContain('curry');
    expect(next.recipeIds).toContain('tajine');
    expect(next.recipeIds).toContain('chili');
  });

  // Un plat du batch reste acheté même si plus aucun repas ne le sert : il est
  // cuisiné le dimanche. C'est l'autre face du même invariant.
  it('garde un plat du batch que plus aucun repas ne sert', () => {
    const plan = makePlan([{}, {}, {}, {}, {}, {}, {}], '2026-09-12', ['curry', 'chili']);
    const next = replaceBatchRecipeInPlan(plan, 'curry', 'tajine');

    expect(next.recipeIds).toContain('tajine');
    expect(next.batchRecipeIds).toEqual(['tajine', 'chili']);
  });

  it('refuse un plat qui n’est pas au batch', () => {
    expect(() => replaceBatchRecipeInPlan(planWithBatch(), 'gratin', 'tajine')).toThrow(
      BatchRecipeNotFoundError,
    );
  });

  it('ne modifie pas le plan reçu', () => {
    const plan = planWithBatch();
    replaceBatchRecipeInPlan(plan, 'curry', 'tajine');
    expect(plan.batchRecipeIds).toEqual(['curry', 'chili']);
    expect(plan.days[2]?.lunch.recipeId).toBe('curry');
  });
});

describe('countMealsServing', () => {
  it('compte les créneaux, pas les jours', () => {
    const portion = (recipeId: string) => ({ recipeId, kind: 'batch-leftover' as const });
    const plan = makePlan(
      [{}, {}, { lunch: portion('curry'), dinner: portion('curry') }, { lunch: portion('curry') }],
      '2026-09-12',
      ['curry'],
    );

    expect(countMealsServing(plan, 'curry')).toBe(3);
    expect(countMealsServing(plan, 'inconnu')).toBe(0);
  });
});
