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
    tags: ['one-pot'],
    ingredients: [{ name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' }],
    steps: ['Tout mettre dans la cocotte.'],
    ...overrides,
  };
}

/**
 * Plan où chaque recette est réellement cuisinée au moins un soir.
 *
 * Volontairement resté sur l'ancienne sémantique — un repas `cooked` par
 * recette — pour que les tests d'écriture continuent de vérifier ce chemin.
 * Les scénarios propres au batch passent `batchRecipeIds` explicitement.
 */
export function makeGeneratedPlan(recipes: GeneratedRecipe[]): GeneratedPlan {
  const days = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => ({
    dayIndex,
    lunch: {
      recipeSlug: recipes[0]?.slug ?? null,
      kind: 'batch-leftover' as const,
      withStarter: false,
      withDessert: false,
    },
    dinner: {
      recipeSlug: recipes[dayIndex % recipes.length]?.slug ?? null,
      kind: 'cooked' as const,
      withStarter: false,
      withDessert: false,
    },
  }));

  return { recipes, batchRecipeSlugs: recipes.map((recipe) => recipe.slug), days };
}
