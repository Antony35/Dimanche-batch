import { z } from 'zod';
import { IsoDateSchema, WeekIdSchema } from './common';

/**
 * Nature d'un repas. Distinguer `batch-leftover` de `cooked` est ce qui permet
 * à la liste de courses de ne pas compter deux fois les ingrédients du batch :
 * seuls les repas `cooked` consomment des ingrédients.
 */
export const MEAL_KINDS = [
  'cooked',
  'batch-leftover',
  'freezer-backup',
  'eat-out',
] as const;

export const MealKindSchema = z.enum(MEAL_KINDS);

export const MealSchema = z.object({
  recipeId: z.string().min(1).nullable(),
  kind: MealKindSchema,
  /** Entrée légère (soupe, crudités) pour réduire la portion du plat. */
  withStarter: z.boolean(),
  /** Dessert simple, typiquement un yaourt. */
  withDessert: z.boolean(),
});

export const DayPlanSchema = z.object({
  date: IsoDateSchema,
  lunch: MealSchema,
  dinner: MealSchema,
});

export const WeeklyPlanSchema = z.object({
  id: WeekIdSchema,
  weekStart: IsoDateSchema,
  days: z.array(DayPlanSchema).length(7),
  /** Toutes les recettes référencées par le plan, pour requêter en une fois. */
  recipeIds: z.array(z.string().min(1)),
  generatedAt: z.number().int(),
  generatedBy: z.string().min(1),
  /** Modèle Gemini utilisé — utile pour comparer la qualité entre versions. */
  model: z.string().min(1),
});

/** Payload de la callable `generateWeeklyPlan`. */
export const GenerateWeeklyPlanInputSchema = z.object({
  householdId: z.string().min(1),
  weekStart: IsoDateSchema,
  /** Contraintes ponctuelles saisies dans l'app, en texte libre. */
  notes: z.string().max(500).optional(),
  /** Régénère en écrasant un plan existant pour cette semaine. */
  force: z.boolean().optional(),
});

export const GenerateWeeklyPlanResultSchema = z.object({
  weekId: WeekIdSchema,
  recipeCount: z.number().int().min(0),
  itemCount: z.number().int().min(0),
});

/** Payload de la callable `regenerateMeal`. */
export const RegenerateMealInputSchema = z.object({
  householdId: z.string().min(1),
  weekId: WeekIdSchema,
  date: IsoDateSchema,
  slot: z.enum(['lunch', 'dinner']),
  notes: z.string().max(500).optional(),
});

export const RegenerateMealResultSchema = z.object({
  weekId: WeekIdSchema,
  /** Identifiant de la recette qui occupe désormais le créneau. */
  recipeId: z.string().min(1),
  recipeName: z.string().min(1),
  itemCount: z.number().int().min(0),
});

export type MealKind = z.infer<typeof MealKindSchema>;
export type Meal = z.infer<typeof MealSchema>;
export type MealSlot = 'lunch' | 'dinner';
export type DayPlan = z.infer<typeof DayPlanSchema>;
export type WeeklyPlan = z.infer<typeof WeeklyPlanSchema>;
export type GenerateWeeklyPlanInput = z.infer<typeof GenerateWeeklyPlanInputSchema>;
export type GenerateWeeklyPlanResult = z.infer<typeof GenerateWeeklyPlanResultSchema>;
export type RegenerateMealInput = z.infer<typeof RegenerateMealInputSchema>;
export type RegenerateMealResult = z.infer<typeof RegenerateMealResultSchema>;
