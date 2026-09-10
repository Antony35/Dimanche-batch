import { z } from 'zod';
import { AisleSchema, IsoDateSchema, RecipeTagSchema, UnitSchema } from './common';

export const IngredientSchema = z.object({
  /** Nom normalisé en minuscules, au singulier — sert de clé d'agrégation. */
  name: z.string().min(1).max(80),
  qty: z.number().positive().max(10_000),
  unit: UnitSchema,
  aisle: AisleSchema,
});

/**
 * Recette telle que stockée dans Firestore. Écrite exclusivement par les Cloud
 * Functions ; le client la lit et ne modifie que `isFavorite` et `isDisliked`.
 */
export const RecipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  /** Nombre de portions produites — pas le nombre de convives. */
  servings: z.number().int().min(1).max(16),
  prepMinutes: z.number().int().min(1).max(240),
  tags: z.array(RecipeTagSchema).max(9),
  ingredients: z.array(IngredientSchema).min(1).max(30),
  steps: z.array(z.string().min(1).max(600)).min(1).max(20),
  lastUsedAt: IsoDateSchema.nullable(),
  isFavorite: z.boolean(),
  /**
   * Plat que le foyer ne veut plus voir proposé. `.default(false)` et non un
   * champ requis : les recettes écrites avant cette fonctionnalité ne le
   * portent pas, et un document qui ne passe pas son schéma est écarté — elles
   * disparaîtraient de l'app. La sortie reste `boolean`, donc
   * `Omit<Recipe, 'id'>` force quand même à l'écrire.
   */
  isDisliked: z.boolean().default(false),
  createdAt: z.number().int(),
});

export type Ingredient = z.infer<typeof IngredientSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
