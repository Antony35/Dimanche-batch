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
 * Functions ; le client la lit et ne modifie que `isFavorite`.
 */
export const RecipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  /** Nombre de portions produites — pas le nombre de convives. */
  servings: z.number().int().min(1).max(12),
  prepMinutes: z.number().int().min(1).max(240),
  tags: z.array(RecipeTagSchema).max(9),
  ingredients: z.array(IngredientSchema).min(1).max(30),
  steps: z.array(z.string().min(1).max(600)).min(1).max(20),
  lastUsedAt: IsoDateSchema.nullable(),
  isFavorite: z.boolean(),
  createdAt: z.number().int(),
});

export type Ingredient = z.infer<typeof IngredientSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
