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

/**
 * Plan conforme au nouveau modèle : trois plats préparés le dimanche nourrissent
 * les dix repas de la semaine, le week-end est pris à l'extérieur.
 *
 * Les portions et les étiquettes sont calibrées pour passer les contraintes —
 * une fixture qui en violerait une rendrait rouge le premier test et suspects
 * tous les autres.
 */
export function makeValidGeneratedPlan(): GeneratedPlan {
  const recipes = [
    makeGeneratedRecipe({ slug: 'batch-curry', tags: ['batch'], servings: 8, prepMinutes: 50 }),
    makeGeneratedRecipe({
      slug: 'chili-sin-carne',
      tags: ['congelable'],
      servings: 8,
      prepMinutes: 50,
    }),
    makeGeneratedRecipe({
      slug: 'soupe-poireaux',
      tags: ['congelable'],
      servings: 4,
      prepMinutes: 30,
    }),
  ];

  const slugFor = (dayIndex: number): string => {
    if (dayIndex <= 3) return 'batch-curry';
    if (dayIndex <= 5) return 'chili-sin-carne';
    return 'soupe-poireaux';
  };

  const days = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
    if (dayIndex < 2) {
      const away = {
        recipeSlug: null,
        kind: 'eat-out' as const,
        withStarter: false,
        withDessert: false,
      };
      return { dayIndex, lunch: away, dinner: { ...away } };
    }
    const portion = {
      recipeSlug: slugFor(dayIndex),
      kind: 'batch-leftover' as const,
      withStarter: false,
      withDessert: false,
    };
    return { dayIndex, lunch: portion, dinner: { ...portion } };
  });

  return {
    recipes,
    batchRecipeSlugs: ['batch-curry', 'chili-sin-carne', 'soupe-poireaux'],
    days,
  };
}
