import { describe, expect, it } from 'vitest';
import {
  BatchRecipeNotFoundError,
  MealNotFoundError,
  collectRecipeIds,
  countUndecidedMeals,
  countMealsServing,
  findMeal,
  findSwapCounterpart,
  isLastMealOfBatchDish,
  listSwapTargets,
  removeBatchRecipeFromPlan,
  replaceBatchRecipeInPlan,
  replaceMealInPlan,
  swapMealsInPlan,
} from '../plan-edit';
import { countBatchMealsServing } from '../batch';
import { buildGroceryList } from '../grocery';
import { makeMeal, makePlan, makeRecipe } from './fixtures';

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

/**
 * Semaine type pour l'échange : curry lundi et mardi (4 repas), chili mercredi
 * et jeudi (4 repas), soupe vendredi (2 repas). Le chili et la soupe se
 * congèlent, pas le curry.
 */
function swapWeek() {
  const portion = (recipeId: string) => ({ recipeId, kind: 'batch-leftover' as const });
  return makePlan(
    [
      {},
      {},
      { lunch: portion('curry'), dinner: portion('curry') },
      { lunch: portion('curry'), dinner: portion('curry') },
      { lunch: portion('chili'), dinner: portion('chili') },
      { lunch: portion('chili'), dinner: portion('chili') },
      { lunch: portion('soupe'), dinner: portion('soupe') },
    ],
    '2026-09-12',
    ['curry', 'chili', 'soupe'],
  );
}

const freezable = (recipeId: string) => recipeId !== 'curry';
const LUNDI = '2026-09-14';
const MERCREDI = '2026-09-16';
const JEUDI = '2026-09-17';

describe('échange de deux repas du batch', () => {
  it('prend au plat voulu son créneau le plus éloigné dans la semaine', () => {
    // Lundi midi on veut du chili : le chili du jeudi soir, le plus loin,
    // cède sa place et reçoit le curry — sauf que le curry ne se congèle pas,
    // donc jeudi est sauté et c'est mercredi soir qui cède.
    const plan = swapWeek();
    expect(findSwapCounterpart(plan, { date: LUNDI, slot: 'lunch' }, 'chili', freezable)).toEqual({
      date: MERCREDI,
      slot: 'dinner',
    });
  });

  it('prend le créneau le plus éloigné quand rien ne l’interdit', () => {
    // Mercredi midi on veut du curry : le chili qu'on quitte se congèle, donc
    // il peut partir n'importe où ; le curry le plus loin est lundi midi.
    const plan = swapWeek();
    expect(
      findSwapCounterpart(plan, { date: MERCREDI, slot: 'lunch' }, 'curry', freezable),
    ).toEqual({ date: LUNDI, slot: 'lunch' });
  });

  it('refuse d’amener en fin de semaine un plat qui ne se congèle pas', () => {
    const plan = swapWeek();
    expect(
      findSwapCounterpart(plan, { date: JEUDI, slot: 'lunch' }, 'curry', freezable),
    ).toBeNull();
  });

  it('ne garde les mêmes comptes que si l’échange est appliqué', () => {
    const plan = swapWeek();
    const ref = { date: LUNDI, slot: 'lunch' as const };
    const counterpart = findSwapCounterpart(plan, ref, 'chili', freezable);
    expect(counterpart).not.toBeNull();

    const next = swapMealsInPlan(plan, ref, counterpart!);
    for (const recipeId of ['curry', 'chili', 'soupe']) {
      expect(countBatchMealsServing(next, recipeId)).toBe(countBatchMealsServing(plan, recipeId));
    }
    expect(findMeal(next, LUNDI, 'lunch')?.recipeId).toBe('chili');
    expect(findMeal(next, MERCREDI, 'dinner')?.recipeId).toBe('curry');
  });

  it('ne change pas la liste de courses', () => {
    const recipes = ['curry', 'chili', 'soupe'].map((id) =>
      makeRecipe({
        id,
        servings: 4,
        ingredients: [{ name: id, qty: 400, unit: 'g', aisle: 'epicerie' }],
      }),
    );
    const plan = swapWeek();
    // Le chili quitté se congèle : il peut partir le vendredi à la place de la soupe.
    const ref = { date: MERCREDI, slot: 'lunch' as const };
    const next = swapMealsInPlan(plan, ref, findSwapCounterpart(plan, ref, 'soupe', freezable)!);

    expect(buildGroceryList(next, recipes)).toEqual(buildGroceryList(plan, recipes));
  });

  it('ne propose pas le plat déjà servi, ni un plat hors du batch', () => {
    const plan = swapWeek();
    const ref = { date: LUNDI, slot: 'lunch' as const };
    expect(findSwapCounterpart(plan, ref, 'curry', freezable)).toBeNull();
    expect(findSwapCounterpart(plan, ref, 'inconnu', freezable)).toBeNull();
    // La soupe n'est servie que vendredi : l'échanger enverrait le curry, qui
    // ne se congèle pas, attendre cinq jours au frigo. Elle n'est pas proposée.
    expect(listSwapTargets(plan, ref, freezable)).toEqual(['chili']);
  });

  it('ne propose rien sur un créneau qui n’est pas une portion du batch', () => {
    const plan = swapWeek();
    expect(listSwapTargets(plan, { date: '2026-09-12', slot: 'lunch' }, freezable)).toEqual([]);
  });
});

describe('isLastMealOfBatchDish', () => {
  it('reconnaît le dernier repas d’un plat, qu’on ne peut pas vider', () => {
    const plan = makePlan(
      [
        {},
        {},
        {
          lunch: { recipeId: 'curry', kind: 'batch-leftover' },
          dinner: { recipeId: 'chili', kind: 'batch-leftover' },
        },
        { lunch: { recipeId: 'curry', kind: 'batch-leftover' } },
      ],
      '2026-09-12',
      ['curry', 'chili'],
    );

    expect(isLastMealOfBatchDish(plan, LUNDI, 'dinner')).toBe(true);
    expect(isLastMealOfBatchDish(plan, LUNDI, 'lunch')).toBe(false);
    expect(isLastMealOfBatchDish(plan, '2026-09-12', 'lunch')).toBe(false);
  });
});

describe('countUndecidedMeals', () => {
  it('compte les repas encore à décider, week-end et semaine', () => {
    const undecided = { recipeId: null, kind: 'undecided' as const };
    const plan = makePlan([
      { lunch: undecided, dinner: undecided },
      { lunch: { recipeId: null, kind: 'eat-out' }, dinner: undecided },
      { lunch: undecided },
    ]);
    // Le lundi compte aussi : un plat retiré du batch y laisse ses repas, et
    // ce qu'on y posera s'achète le samedi.
    expect(countUndecidedMeals(plan)).toBe(4);
  });
});

/**
 * Retirer un plat, c'est ne plus le cuisiner ni l'acheter. L'invariant protégé
 * est le même que pour un remplacement : si le plat reste dans
 * `batchRecipeIds`, il reste dans `recipeIds`, et la liste l'achète encore.
 */
describe('removeBatchRecipeFromPlan', () => {
  const portion = (recipeId: string) => ({ recipeId, kind: 'batch-leftover' as const });

  /** Curry lundi midi et soir, chili mardi midi, soupe mardi soir, reste samedi. */
  function planWithBatch() {
    return makePlan(
      [
        { lunch: { recipeId: 'gratin', kind: 'freezer-backup' } },
        {},
        { lunch: portion('curry'), dinner: portion('curry') },
        { lunch: portion('chili'), dinner: portion('soupe') },
      ],
      '2026-09-12',
      ['curry', 'chili', 'soupe'],
    );
  }

  it('passe à décider tous les repas du plat, et eux seuls', () => {
    const next = removeBatchRecipeFromPlan(planWithBatch(), 'curry');

    expect(next.days[2]?.lunch).toEqual(makeMeal({ recipeId: null, kind: 'undecided' }));
    expect(next.days[2]?.dinner.kind).toBe('undecided');
    expect(next.days[3]?.lunch.recipeId).toBe('chili');
    expect(next.days[0]?.lunch.recipeId).toBe('gratin');
  });

  it('sort le plat du batch en gardant l’ordre des autres', () => {
    const next = removeBatchRecipeFromPlan(planWithBatch(), 'chili');
    expect(next.batchRecipeIds).toEqual(['curry', 'soupe']);
  });

  it('sort le plat de recipeIds, donc de la liste de courses', () => {
    const recipes = [
      makeRecipe({
        id: 'curry',
        ingredients: [{ name: 'lait de coco', qty: 400, unit: 'ml', aisle: 'epicerie' }],
      }),
      makeRecipe({ id: 'chili' }),
      makeRecipe({ id: 'soupe' }),
    ];
    const next = removeBatchRecipeFromPlan(planWithBatch(), 'curry');

    expect(next.recipeIds).not.toContain('curry');
    expect(next.recipeIds).toEqual(expect.arrayContaining(['chili', 'soupe', 'gratin']));
    expect(buildGroceryList(next, recipes).map((item) => item.name)).not.toContain('lait de coco');
  });

  it('permet de retirer le dernier plat : la semaine se vit de restes', () => {
    let plan = planWithBatch();
    for (const id of ['curry', 'chili', 'soupe']) plan = removeBatchRecipeFromPlan(plan, id);

    expect(plan.batchRecipeIds).toEqual([]);
    expect(plan.recipeIds).toEqual(['gratin']);
    expect(buildGroceryList(plan, [makeRecipe({ id: 'gratin' })])).toEqual([]);
  });

  it('libère aussi le dernier repas d’un plat déjà vidé ailleurs', () => {
    // Le geste « vider le dernier repas » : le repas est d'abord remplacé,
    // puis le plat, qui ne sert plus rien, est désinscrit.
    const emptied = replaceMealInPlan(
      planWithBatch(),
      '2026-09-15',
      'lunch',
      makeMeal({ recipeId: 'gratin', kind: 'freezer-backup' }),
    );
    const next = removeBatchRecipeFromPlan(emptied, 'chili');

    expect(next.days[3]?.lunch.recipeId).toBe('gratin');
    expect(next.batchRecipeIds).toEqual(['curry', 'soupe']);
    expect(next.recipeIds).not.toContain('chili');
  });

  it('refuse un plat qui n’est pas au batch', () => {
    expect(() => removeBatchRecipeFromPlan(planWithBatch(), 'gratin')).toThrow(
      BatchRecipeNotFoundError,
    );
  });

  it('ne modifie pas le plan reçu', () => {
    const plan = planWithBatch();
    removeBatchRecipeFromPlan(plan, 'curry');
    expect(plan.batchRecipeIds).toEqual(['curry', 'chili', 'soupe']);
    expect(plan.days[2]?.lunch.recipeId).toBe('curry');
  });
});
