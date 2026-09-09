import type { Recipe } from '../../schemas/recipe';
import type { GeneratedPlan, GeneratedRecipe } from '../../schemas/gemini';
import type { DayPlan, Meal, WeeklyPlan } from '../../schemas/weekly-plan';
import { getWeekDates } from '../week';

export function makeRecipe(overrides: Partial<Recipe> & Pick<Recipe, 'id'>): Recipe {
  return {
    name: 'Recette test',
    servings: 2,
    prepMinutes: 25,
    tags: ['one-pot'],
    ingredients: [{ name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' }],
    steps: ['Tout mettre dans la cocotte.'],
    lastUsedAt: null,
    isFavorite: false,
    createdAt: 0,
    ...overrides,
  };
}

export function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    recipeId: null,
    kind: 'eat-out',
    withStarter: false,
    withDessert: false,
    ...overrides,
  };
}

export function makePlan(
  days: Array<{ lunch?: Partial<Meal>; dinner?: Partial<Meal> }>,
  weekStart = '2026-09-12',
  batchRecipeIds: string[] = [],
): WeeklyPlan {
  const dates = getWeekDates(weekStart);
  const planDays: DayPlan[] = dates.map((date, index) => ({
    date,
    lunch: makeMeal(days[index]?.lunch),
    dinner: makeMeal(days[index]?.dinner),
  }));

  return {
    id: weekStart,
    weekStart,
    days: planDays,
    recipeIds: [],
    batchRecipeIds,
    generatedAt: 0,
    generatedBy: 'uid-test',
    model: 'gemini-test',
  };
}

export function makeGeneratedRecipe(
  overrides: Partial<GeneratedRecipe> & Pick<GeneratedRecipe, 'slug'>,
): GeneratedRecipe {
  return {
    name: 'Recette générée',
    servings: 2,
    prepMinutes: 25,
    tags: ['one-pot', 'healthy'],
    ingredients: [{ name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' }],
    steps: ['Tout mettre dans la cocotte.'],
    ...overrides,
  };
}

/**
 * Plan généré conforme à toutes les contraintes — base des tests de violation.
 *
 * Rappel de l'indexation : 0 = samedi, 1 = dimanche, 2 à 6 = lundi à vendredi.
 * Le week-end tolère un plat long et non one-pot ; la semaine non.
 */
export function makeValidGeneratedPlan(): GeneratedPlan {
  const recipes: GeneratedRecipe[] = [
    makeGeneratedRecipe({ slug: 'batch-curry', tags: ['one-pot', 'healthy', 'batch'] }),
    makeGeneratedRecipe({ slug: 'soupe-poireaux', tags: ['one-pot', 'congelable'] }),
    makeGeneratedRecipe({ slug: 'chili-sin-carne', tags: ['one-pot', 'congelable'] }),
    makeGeneratedRecipe({ slug: 'risotto-weekend', tags: ['weekend'], prepMinutes: 60 }),
  ];

  /** Le risotto n'est servi que le samedi : ailleurs il violerait la semaine. */
  const dinnerSlug = (dayIndex: number): string => {
    if (dayIndex === 0) return 'risotto-weekend';
    if (dayIndex === 1) return 'batch-curry';
    if (dayIndex <= 4) return 'chili-sin-carne';
    return 'soupe-poireaux';
  };

  const days = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => ({
    dayIndex,
    lunch: {
      recipeSlug: 'batch-curry',
      kind: 'batch-leftover' as const,
      withStarter: false,
      withDessert: false,
    },
    dinner: {
      recipeSlug: dinnerSlug(dayIndex),
      kind: 'cooked' as const,
      withStarter: dayIndex >= 2,
      withDessert: dayIndex <= 1,
    },
  }));

  return { recipes, batchRecipeSlugs: ['batch-curry'], days };
}
