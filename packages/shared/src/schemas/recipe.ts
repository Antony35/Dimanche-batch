import { z } from 'zod';
import { AisleSchema, IsoDateSchema, RecipeTagSchema, UnitSchema } from './common';

export const IngredientSchema = z.object({
  /** Nom normalisé en minuscules, au singulier — sert de clé d'agrégation. */
  name: z.string().min(1).max(80),
  qty: z.number().positive().max(10_000),
  unit: UnitSchema,
  aisle: AisleSchema,
  /**
   * Ingrédient que la recette demandait avant un remplacement par le foyer
   * (`substituteIngredient`). Absent tant qu'on n'a rien remplacé : les étapes,
   * qui ne sont pas réécrites, le citent encore, et la fiche le rappelle.
   */
  originalName: z.string().min(1).max(80).optional(),
});

/**
 * Recette telle que stockée dans Firestore. Écrite exclusivement par les Cloud
 * Functions ; le client la lit et ne modifie que `isFavorite` et `isDisliked`.
 */
export const RecipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  /** Nombre de portions produites — pas le nombre de convives. */
  servings: z.number().int().min(1).max(20),
  /** Temps de présence en cuisine : éplucher, découper, surveiller. */
  prepMinutes: z.number().int().min(1).max(240),
  /**
   * Temps de cuisson sans surveillance — la cocotte qui mijote, le four qui
   * tourne. Distinct de `prepMinutes` parce que le dimanche ne se mesure qu'en
   * présence : un plat mijoté trois heures n'en coûte que vingt au cuisinier.
   * `.default(0)` : les recettes écrites avant ce champ ne le portent pas.
   */
  cookMinutes: z.number().int().min(0).max(480).default(0),
  tags: z.array(RecipeTagSchema).max(11),
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

/**
 * Payload de la callable `substituteIngredient` : remplacer un ingrédient d'une
 * recette par un autre de même catégorie. L'ingrédient est désigné par son nom,
 * pas par sa position — l'autre téléphone a pu modifier la recette entre-temps.
 */
export const SubstituteIngredientInputSchema = z.object({
  householdId: z.string().min(1),
  recipeId: z.string().min(1),
  ingredientName: z.string().min(1).max(80),
  substitute: z.string().min(1).max(80),
});

export const SubstituteIngredientResultSchema = z.object({
  recipeId: z.string().min(1),
  /** Nom écrit dans la recette, tel que le domaine l'a normalisé. */
  ingredientName: z.string().min(1),
  /** Semaines dont la liste de courses a été recalculée. */
  weekIds: z.array(IsoDateSchema),
});

export type Ingredient = z.infer<typeof IngredientSchema>;
export type SubstituteIngredientInput = z.infer<typeof SubstituteIngredientInputSchema>;
export type SubstituteIngredientResult = z.infer<typeof SubstituteIngredientResultSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
