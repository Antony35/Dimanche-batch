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
 * Semaine du samedi au vendredi : 0 = samedi, 1 = dimanche, 2 à 6 = lundi à
 * vendredi. Le week-end se cuisine le jour même ; les dix repas de semaine sont
 * des portions de trois plats préparés le dimanche.
 *
 * Les portions sont calibrées au plus juste : chaque plat sert quatre repas
 * pour huit portions, sauf le dernier qui en sert deux. Les plats servis en fin
 * de semaine portent « congelable », comme la contrainte l'exige.
 */
export function makeValidGeneratedPlan(): GeneratedPlan {
  const recipes: GeneratedRecipe[] = [
    makeGeneratedRecipe({
      slug: 'batch-curry',
      tags: ['batch', 'healthy'],
      servings: 8,
      prepMinutes: 50,
    }),
    makeGeneratedRecipe({
      slug: 'chili-sin-carne',
      tags: ['batch', 'congelable'],
      servings: 8,
      prepMinutes: 50,
    }),
    makeGeneratedRecipe({
      slug: 'soupe-poireaux',
      tags: ['batch', 'congelable'],
      servings: 4,
      prepMinutes: 30,
    }),
    makeGeneratedRecipe({ slug: 'risotto-weekend', tags: ['weekend'], prepMinutes: 60 }),
  ];

  /** Lundi et mardi le curry, mercredi et jeudi le chili, vendredi la soupe. */
  const weekdaySlug = (dayIndex: number): string => {
    if (dayIndex <= 3) return 'batch-curry';
    if (dayIndex <= 5) return 'chili-sin-carne';
    return 'soupe-poireaux';
  };

  const days = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
    if (dayIndex >= 2) {
      const portion = {
        recipeSlug: weekdaySlug(dayIndex),
        kind: 'batch-leftover' as const,
        withStarter: false,
        withDessert: false,
      };
      return { dayIndex, lunch: portion, dinner: { ...portion } };
    }

    // Samedi et dimanche : un plat frais le soir, rien de prévu le midi.
    return {
      dayIndex,
      lunch: {
        recipeSlug: null,
        kind: 'eat-out' as const,
        withStarter: false,
        withDessert: false,
      },
      dinner: {
        recipeSlug: 'risotto-weekend',
        kind: 'cooked' as const,
        withStarter: false,
        withDessert: true,
      },
    };
  });

  return {
    recipes,
    batchRecipeSlugs: ['batch-curry', 'chili-sin-carne', 'soupe-poireaux'],
    days,
  };
}
