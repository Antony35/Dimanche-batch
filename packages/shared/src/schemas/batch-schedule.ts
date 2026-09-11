import { z } from 'zod';
import { WeekIdSchema } from './common';

/**
 * Déroulé entrelacé du dimanche : les étapes des plats du batch, fondues en une
 * seule séquence.
 *
 * Chaque étape nomme les plats qu'elle concerne. C'est ce qui répond à la
 * crainte qui avait fait différer cette vue : mêler les gestes de quatre plats
 * produit une liste qu'on ne rattache plus à un plat quand on s'y perd. Une
 * étape peut en concerner plusieurs — c'est même tout l'intérêt : éplucher les
 * oignons des trois plats d'un coup.
 */
export const BatchScheduleStepSchema = z.object({
  recipeIds: z.array(z.string().min(1)).min(1).max(6),
  text: z.string().min(1).max(400),
});

/** Ce que le modèle rend — les identifiants sont les slugs, donc les `recipeId`. */
export const GeneratedBatchScheduleSchema = z.object({
  steps: z.array(BatchScheduleStepSchema).min(3).max(80),
});

/**
 * Document `batchSchedules/{weekId}`, écrit par la function.
 *
 * `sourceRecipeIds` fige le batch à partir duquel le déroulé a été composé. Si
 * un plat est remplacé ensuite, le déroulé décrit un batch qui n'existe plus :
 * l'app le compare au plan plutôt que de compter sur chaque écrivain pour
 * penser à l'effacer.
 */
export const BatchScheduleSchema = z.object({
  id: WeekIdSchema,
  sourceRecipeIds: z.array(z.string().min(1)),
  steps: z.array(BatchScheduleStepSchema),
  generatedAt: z.number().int(),
  generatedBy: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.number().int().min(1),
});

export const GenerateBatchScheduleInputSchema = z.object({
  householdId: z.string().min(1),
  weekId: WeekIdSchema,
});

export const GenerateBatchScheduleResultSchema = z.object({
  weekId: WeekIdSchema,
  stepCount: z.number().int().min(0),
  /** Faux si un déroulé à jour existait déjà : rien n'a été généré ni décompté. */
  generated: z.boolean(),
});

export type BatchScheduleStep = z.infer<typeof BatchScheduleStepSchema>;
export type GeneratedBatchSchedule = z.infer<typeof GeneratedBatchScheduleSchema>;
export type BatchSchedule = z.infer<typeof BatchScheduleSchema>;
export type GenerateBatchScheduleInput = z.infer<typeof GenerateBatchScheduleInputSchema>;
export type GenerateBatchScheduleResult = z.infer<typeof GenerateBatchScheduleResultSchema>;
