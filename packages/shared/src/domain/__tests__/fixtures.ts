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
  weekStart = '2026-09-14',
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

/** Plan généré conforme à toutes les contraintes — base des tests de violation. */
export function makeValidGeneratedPlan(): GeneratedPlan {
  const recipes: GeneratedRecipe[] = [
    makeGeneratedRecipe({ slug: 'batch-curry', tags: ['one-pot', 'healthy', 'batch'] }),
    makeGeneratedRecipe({ slug: 'soupe-poireaux', tags: ['one-pot', 'congelable'] }),
    makeGeneratedRecipe({ slug: 'chili-sin-carne', tags: ['one-pot', 'congelable'] }),
    makeGeneratedRecipe({ slug: 'risotto-weekend', tags: ['weekend'], prepMinutes: 60 }),
  ];

  const days = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => ({
    dayIndex,
    lunch: {
      recipeSlug: 'batch-curry',
      kind: 'batch-leftover' as const,
      withStarter: false,
      withDessert: false,
    },
    dinner:
      dayIndex <= 1
        ? {
            recipeSlug: 'soupe-poireaux',
            kind: 'cooked' as const,
            withStarter: false,
            withDessert: true,
          }
        : dayIndex <= 4
          ? {
              recipeSlug: 'chili-sin-carne',
              kind: 'cooked' as const,
              withStarter: true,
              withDessert: false,
            }
          : dayIndex === 5
            ? {
                recipeSlug: 'risotto-weekend',
                kind: 'cooked' as const,
                withStarter: false,
                withDessert: true,
              }
            : {
                recipeSlug: 'batch-curry',
                kind: 'cooked' as const,
                withStarter: false,
                withDessert: false,
              },
  }));

  return { recipes, days };
}
