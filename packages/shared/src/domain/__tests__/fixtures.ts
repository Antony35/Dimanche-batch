import type { Recipe } from '../../schemas/recipe';
import type { GeneratedPlan, GeneratedRecipe } from '../../schemas/gemini';
import type { DayPlan, Meal, WeeklyPlan } from '../../schemas/weekly-plan';
import { getWeekDates } from '../week';

export function makeRecipe(overrides: Partial<Recipe> & Pick<Recipe, 'id'>): Recipe {
  return {
    name: 'Recette test',
    servings: 2,
    prepMinutes: 25,
    cookMinutes: 0,
    tags: ['one-pot'],
    ingredients: [{ name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' }],
    steps: ['Tout mettre dans la cocotte.'],
    lastUsedAt: null,
    isFavorite: false,
    isDisliked: false,
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
    cookMinutes: 0,
    tags: ['one-pot', 'healthy'],
    ingredients: [{ name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' }],
    steps: ['Tout mettre dans la cocotte.'],
    ...overrides,
  };
}

/** Quel plat sert quel créneau, du lundi (2) au vendredi (6). */
export type WeekdayServing = Record<2 | 3 | 4 | 5 | 6, [lunch: string, dinner: string]>;

export function makeGeneratedDays(serving: WeekdayServing): GeneratedPlan['days'] {
  return ([2, 3, 4, 5, 6] as const).map((dayIndex) => {
    const [lunch, dinner] = serving[dayIndex];
    const meal = (recipeSlug: string) => ({
      recipeSlug,
      kind: 'batch-leftover' as const,
      withStarter: false,
      withDessert: false,
    });
    return { dayIndex, lunch: meal(lunch), dinner: meal(dinner) };
  });
}

/**
 * Plan généré conforme à toutes les contraintes — base des tests de violation.
 *
 * Le modèle ne décrit que le lundi au vendredi. Trois plats nourrissent les dix
 * repas, répartis 4, 3 et 3 — donc 8, 6 et 6 portions. Le curry mijote, ce qui
 * tient la règle du dimanche ; le chili et la soupe, servis jeudi ou vendredi,
 * portent « congelable ».
 */
export function makeValidGeneratedPlan(): GeneratedPlan {
  const recipes: GeneratedRecipe[] = [
    makeGeneratedRecipe({
      slug: 'batch-curry',
      name: 'Curry de lentilles',
      tags: ['batch', 'healthy', 'mijote'],
      servings: 8,
      prepMinutes: 50,
      cookMinutes: 90,
    }),
    makeGeneratedRecipe({
      slug: 'chili-sin-carne',
      name: 'Chili sin carne',
      tags: ['batch', 'congelable'],
      servings: 6,
      prepMinutes: 50,
    }),
    makeGeneratedRecipe({
      slug: 'soupe-poireaux',
      name: 'Soupe de poireaux',
      tags: ['batch', 'congelable'],
      servings: 6,
      prepMinutes: 30,
    }),
  ];

  return {
    recipes,
    batchRecipeSlugs: ['batch-curry', 'chili-sin-carne', 'soupe-poireaux'],
    days: makeGeneratedDays({
      2: ['batch-curry', 'batch-curry'],
      3: ['batch-curry', 'batch-curry'],
      4: ['chili-sin-carne', 'chili-sin-carne'],
      5: ['chili-sin-carne', 'soupe-poireaux'],
      6: ['soupe-poireaux', 'soupe-poireaux'],
    }),
  };
}
