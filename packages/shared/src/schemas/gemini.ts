import { z } from 'zod';
import { AisleSchema, RecipeTagSchema, UnitSchema } from './common';
import { MealKindSchema } from './weekly-plan';

/**
 * Contrat de la réponse Gemini.
 *
 * Le modèle ne connaît pas les identifiants Firestore : il nomme ses recettes
 * par un `slug` local au plan, et les jours y font référence. La Cloud Function
 * résout ensuite slug -> recipeId au moment de l'écriture. C'est ce découplage
 * qui permet de valider la cohérence du plan avant d'écrire quoi que ce soit.
 */
export const GeneratedRecipeSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/, 'slug en minuscules, tirets uniquement'),
  name: z.string().min(1).max(120),
  servings: z.number().int().min(1).max(16),
  prepMinutes: z.number().int().min(1).max(240),
  tags: z.array(RecipeTagSchema).min(1).max(9),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        qty: z.number().positive().max(10_000),
        unit: UnitSchema,
        aisle: AisleSchema,
      }),
    )
    .min(1)
    .max(30),
  steps: z.array(z.string().min(1).max(600)).min(1).max(20),
});

export const GeneratedMealSchema = z.object({
  recipeSlug: z.string().nullable(),
  kind: MealKindSchema,
  withStarter: z.boolean(),
  withDessert: z.boolean(),
});

export const GeneratedDaySchema = z.object({
  /** Index 0 = lundi. Plus robuste qu'une date, que le modèle calcule mal. */
  dayIndex: z.number().int().min(0).max(6),
  lunch: GeneratedMealSchema,
  dinner: GeneratedMealSchema,
});

export const GeneratedPlanSchema = z.object({
  recipes: z.array(GeneratedRecipeSchema).min(3).max(12),
  /**
   * Plats préparés le dimanche, dans l'ordre de préparation — c'est cet ordre
   * que suit l'écran de préparation, sans champ supplémentaire à demander.
   * Champ plat plutôt qu'objet englobant : l'API refuse certaines constructions
   * de schéma sans nommer le champ fautif, un niveau d'imbrication en moins est
   * un risque en moins (voir `functions/src/gemini/response-schema.ts`).
   */
  batchRecipeSlugs: z.array(z.string()).min(1).max(8),
  days: z.array(GeneratedDaySchema).length(7),
});

/** Réponse attendue pour la régénération d'un seul repas. */
export const GeneratedMealReplacementSchema = z.object({
  recipe: GeneratedRecipeSchema,
});

export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;
export type GeneratedMeal = z.infer<typeof GeneratedMealSchema>;
export type GeneratedDay = z.infer<typeof GeneratedDaySchema>;
export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>;
export type GeneratedMealReplacement = z.infer<typeof GeneratedMealReplacementSchema>;
