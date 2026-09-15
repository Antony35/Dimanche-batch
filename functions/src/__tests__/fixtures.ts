import type { GeneratedPlan, GeneratedRecipe } from '@dimanche-batch/shared';

export const HOUSEHOLD_ID = 'household-test';
export const WEEK_START = '2026-09-12';
export const ALICE = 'uid-alice';
export const BOB = 'uid-bob';
export const MALLORY = 'uid-mallory';
export const MODEL = 'gemini-test';

export function makeGeneratedRecipe(
  overrides: Partial<GeneratedRecipe> & Pick<GeneratedRecipe, 'slug'>,
): GeneratedRecipe {
  return {
    name: 'Recette générée',
    servings: 2,
    prepMinutes: 25,
    cookMinutes: 0,
    tags: ['one-pot'],
    ingredients: [{ name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' }],
    steps: ['Tout mettre dans la cocotte.'],
    ...overrides,
  };
}

/** Une portion du batch, pour composer les jours de semaine d'un plan généré. */
export function portion(recipeSlug: string) {
  return { recipeSlug, kind: 'batch-leftover' as const, withStarter: false, withDessert: false };
}

/**
 * Plan dont toutes les recettes sont des plats du batch, servis à tour de rôle
 * du lundi au vendredi — le midi par la première, le soir par roulement.
 *
 * Il ne passe pas forcément les contraintes métier : il sert aux tests
 * d'écriture, qui n'appellent pas le validateur.
 */
export function makeGeneratedPlan(recipes: GeneratedRecipe[]): GeneratedPlan {
  const days = [2, 3, 4, 5, 6].map((dayIndex) => ({
    dayIndex,
    lunch: portion(recipes[0]?.slug ?? 'inconnue'),
    dinner: portion(recipes[dayIndex % recipes.length]?.slug ?? 'inconnue'),
  }));

  return { recipes, batchRecipeSlugs: recipes.map((recipe) => recipe.slug), days };
}

/**
 * Plan conforme au nouveau modèle : trois plats préparés le dimanche nourrissent
 * les dix repas de la semaine, répartis 4, 3 et 3 — donc 8, 6 et 6 portions. Le
 * modèle ne décrit ni le samedi ni le dimanche.
 *
 * Les portions et les étiquettes sont calibrées pour passer les contraintes —
 * une fixture qui en violerait une rendrait rouge le premier test et suspects
 * tous les autres.
 */
export function makeValidGeneratedPlan(): GeneratedPlan {
  const recipes = [
    makeGeneratedRecipe({
      slug: 'batch-curry',
      tags: ['batch', 'mijote'],
      servings: 8,
      prepMinutes: 50,
      cookMinutes: 90,
    }),
    makeGeneratedRecipe({
      slug: 'chili-sin-carne',
      tags: ['congelable'],
      servings: 6,
      prepMinutes: 50,
    }),
    makeGeneratedRecipe({
      slug: 'soupe-poireaux',
      tags: ['congelable'],
      servings: 6,
      prepMinutes: 30,
    }),
  ];

  const serving: Record<number, [string, string]> = {
    2: ['batch-curry', 'batch-curry'],
    3: ['batch-curry', 'batch-curry'],
    4: ['chili-sin-carne', 'chili-sin-carne'],
    5: ['chili-sin-carne', 'soupe-poireaux'],
    6: ['soupe-poireaux', 'soupe-poireaux'],
  };

  return {
    recipes,
    batchRecipeSlugs: ['batch-curry', 'chili-sin-carne', 'soupe-poireaux'],
    days: [2, 3, 4, 5, 6].map((dayIndex) => ({
      dayIndex,
      lunch: portion(serving[dayIndex]![0]),
      dinner: portion(serving[dayIndex]![1]),
    })),
  };
}
