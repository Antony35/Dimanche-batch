import { z } from 'zod';
import { AisleSchema, UnitSchema, WeekIdSchema } from './common';

/**
 * D'où vient un article, et ce que la liste en fait à l'écran.
 *
 * `batch` est le gros des courses : ce qui sera cuisiné le dimanche. `fresh` est
 * ce qu'un repas du samedi ou du dimanche demande en plus. `manual` est ce que
 * le foyer a ajouté lui-même, et c'est le seul qu'il puisse supprimer.
 *
 * Champ explicite plutôt que déduit de `fromRecipeIds` à l'écran : l'origine est
 * une règle métier — un article qui sert les deux compte comme `batch` — et une
 * règle métier ne se rejoue pas dans un composant.
 */
export const GROCERY_ORIGINS = ['batch', 'fresh', 'manual'] as const;

export const GroceryOriginSchema = z.enum(GROCERY_ORIGINS);

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
  /**
   * `.default` et non un champ requis : les articles écrits avant l'origine ne
   * la portent pas, et un document qui ne passe pas son schéma est écarté — la
   * liste de courses du foyer se serait vidée à la mise à jour. La sortie reste
   * `GroceryOrigin`, donc `Omit<GroceryItem, 'id'>` force quand même à l'écrire.
   */
  origin: GroceryOriginSchema.default('batch'),
  /** Recettes à l'origine de cet article, pour expliquer une quantité à l'écran. */
  fromRecipeIds: z.array(z.string().min(1)),
});

/** Document parent : métadonnées seulement, les articles sont en sous-collection. */
export const GroceryListSchema = z.object({
  id: WeekIdSchema,
  itemCount: z.number().int().min(0),
  generatedAt: z.number().int(),
});

/**
 * Article ajouté à la main, rattaché au foyer et non à une semaine.
 *
 * On ajoute « sel » parce qu'il n'y en a plus : tant qu'il n'est pas acheté, il
 * doit figurer sur toutes les listes qui suivent, pas seulement sur celle où il
 * a été saisi. Un article par semaine obligerait à le recopier de liste en
 * liste, et à décider quoi faire d'une copie supprimée ici et pas là.
 *
 * Il apparaît dans la liste de `addedWeekId` et de toutes les semaines
 * suivantes, jusqu'à être rayé — il reste alors visible, coché, dans la
 * semaine où il l'a été, puis disparaît des suivantes — ou supprimé.
 */
export const ManualItemSchema = z.object({
  /** `manualItemId(nom, dimension)` : ajouter deux fois le même article le met à jour. */
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  qty: z.number().positive(),
  unit: UnitSchema,
  aisle: AisleSchema,
  /** Semaine de la liste où il a été saisi. */
  addedWeekId: WeekIdSchema,
  /** Semaine de la liste où il a été rayé, `null` tant qu'il reste à acheter. */
  checkedWeekId: WeekIdSchema.nullable(),
});

/**
 * Rayons que le foyer a lui-même attribués, un seul document par foyer.
 *
 * Quand la table livrée ne connaît pas un article, ou le range mal, la
 * correction de l'utilisateur est gardée ici : elle vaut pour les deux
 * téléphones, survit à une réinstallation, et repasse devant la table à la
 * prochaine saisie. C'est aussi la liste des manques à reverser dans la table
 * livrée. La clé est `aisleOverrideKey(nom)`.
 */
export const AisleLexiconSchema = z.object({
  entries: z.record(z.string().min(1), AisleSchema),
});

export type AisleLexicon = z.infer<typeof AisleLexiconSchema>;
export type GroceryOrigin = z.infer<typeof GroceryOriginSchema>;
export type GroceryItem = z.infer<typeof GroceryItemSchema>;
export type ManualItem = z.infer<typeof ManualItemSchema>;
export type GroceryList = z.infer<typeof GroceryListSchema>;
