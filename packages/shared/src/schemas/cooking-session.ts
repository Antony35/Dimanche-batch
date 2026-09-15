import { z } from 'zod';
import { WeekIdSchema } from './common';

/**
 * Session du dimanche, en deux temps : la mise en place, puis la cuisson.
 *
 * Une fois tout coupé d'un coup, il ne reste à chaque plat que ses gestes de
 * cuisson et de mélange. Le modèle réécrit donc les étapes de chaque recette
 * sans la découpe, et dit comment couper chaque ingrédient — « émincé », « en
 * dés » —, sans quoi l'information disparaîtrait avec les étapes qui la
 * portaient. Les quantités et l'ordre, eux, se calculent : voir
 * `domain/mise-en-place.ts` et `orderForCooking`.
 *
 * Deux listes à plat plutôt qu'un objet par plat : l'API refuse certaines
 * imbrications de schéma sans nommer le champ fautif (voir
 * `functions/src/gemini/response-schema.ts`).
 */

/** La façon de couper un ingrédient pour un plat donné. */
export const BatchCutSchema = z.object({
  recipeId: z.string().min(1),
  /** Le nom tel que la recette l'écrit. */
  ingredient: z.string().min(1).max(80),
  /** « émincé », « en dés », « haché »… */
  cut: z.string().min(1).max(40),
});

/** Une étape de cuisson ou de mélange. L'ordre du tableau est l'ordre du plat. */
export const BatchCookStepSchema = z.object({
  recipeId: z.string().min(1),
  text: z.string().min(1).max(400),
});

/**
 * Temps de cuisson sans surveillance d'un plat, **tel que ses étapes réécrites
 * l'indiquent**. C'est la seule source de l'écran : le temps déclaré à la
 * génération de la semaine et le texte des étapes, produits séparément,
 * finissaient par se contredire.
 */
export const BatchTimingSchema = z.object({
  recipeId: z.string().min(1),
  cookMinutes: z.number().int().min(0).max(480),
});

/** Ce que le modèle rend — les identifiants sont les slugs, donc les `recipeId`. */
export const GeneratedCookingSessionSchema = z.object({
  cuts: z.array(BatchCutSchema).max(120),
  steps: z.array(BatchCookStepSchema).min(1).max(80),
  /** `.default` : une session composée avant ce champ reste lisible, et l'écran retombe sur la recette. */
  timings: z.array(BatchTimingSchema).max(6).default([]),
});

/**
 * Document `batchSessions/{weekId}`, écrit par la function.
 *
 * `sourceRecipeIds` fige le batch à partir duquel la session a été composée. Si
 * un plat est remplacé ensuite, elle décrit un batch qui n'existe plus : l'app
 * la compare au plan plutôt que de compter sur chaque écrivain pour l'effacer.
 */
export const CookingSessionSchema = GeneratedCookingSessionSchema.extend({
  id: WeekIdSchema,
  sourceRecipeIds: z.array(z.string().min(1)),
  generatedAt: z.number().int(),
  generatedBy: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.number().int().min(1),
});

export const ComposeCookingSessionInputSchema = z.object({
  householdId: z.string().min(1),
  weekId: WeekIdSchema,
});

export const ComposeCookingSessionResultSchema = z.object({
  weekId: WeekIdSchema,
  stepCount: z.number().int().min(0),
  /** Faux si une session à jour existait déjà : rien n'a été généré ni décompté. */
  generated: z.boolean(),
});

export type BatchCut = z.infer<typeof BatchCutSchema>;
export type BatchCookStep = z.infer<typeof BatchCookStepSchema>;
export type BatchTiming = z.infer<typeof BatchTimingSchema>;
export type GeneratedCookingSession = z.infer<typeof GeneratedCookingSessionSchema>;
export type CookingSession = z.infer<typeof CookingSessionSchema>;
export type ComposeCookingSessionInput = z.infer<typeof ComposeCookingSessionInputSchema>;
export type GenerateCookingSessionResult = z.infer<typeof ComposeCookingSessionResultSchema>;
