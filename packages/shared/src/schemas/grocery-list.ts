import { z } from 'zod';
import { AisleSchema, UnitSchema, WeekIdSchema } from './common';

/**
 * Un article de courses est un document à part entière, pas une entrée d'un
 * tableau. Deux raisons, dans cet ordre :
 *
 * 1. Sécurité — les Security Rules peuvent alors n'autoriser la modification
 *    que du champ `checked`. Sur un tableau, cocher une case impose de
 *    réécrire tout le document, et la règle ne peut plus rien garantir.
 * 2. Concurrence — vous cochez à deux dans le même magasin ; deux écritures
 *    sur deux documents distincts ne s'écrasent pas.
 */
export const GroceryItemSchema = z.object({
  /** Dérivé du nom normalisé et de la dimension d'unité — voir `domain/grocery.ts`. */
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  qty: z.number().positive(),
  unit: UnitSchema,
  aisle: AisleSchema,
  checked: z.boolean(),
  /** Recettes à l'origine de cet article, pour expliquer une quantité à l'écran. */
  fromRecipeIds: z.array(z.string().min(1)),
});

/** Document parent : métadonnées seulement, les articles sont en sous-collection. */
export const GroceryListSchema = z.object({
  id: WeekIdSchema,
  itemCount: z.number().int().min(0),
  generatedAt: z.number().int(),
});

export type GroceryItem = z.infer<typeof GroceryItemSchema>;
export type GroceryList = z.infer<typeof GroceryListSchema>;
