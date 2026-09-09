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
  /**
   * Plats préparés le dimanche (`dayIndex` 1), dans l'ordre de préparation.
   * Ils nourrissent les dix repas du lundi au vendredi.
   *
   * `.default([])` et non `.optional()` : la sortie reste `string[]`, un plan
   * composé avant l'introduction du batch parse et rend un tableau vide, et
   * `Omit<WeeklyPlan, 'id'>` côté écriture force à renseigner le champ — un
   * oubli devient une erreur de compilation plutôt qu'un document incomplet.
   */
  batchRecipeIds: z.array(z.string().min(1)).default([]),
  generatedAt: z.number().int(),
  generatedBy: z.string().min(1),
  /** Modèle Gemini utilisé — utile pour comparer la qualité entre versions. */
  model: z.string().min(1),
  /**
   * Version du prompt qui a produit ce plan. Stockée avec le modèle et pour la
   * même raison : quand une semaine revient bancale, il faut pouvoir dire quelle
   * formulation l'a composée. Absente des plans écrits avant son introduction.
   */
  promptVersion: z.number().int().min(1).optional(),
});

/** Payload de la callable `generateWeeklyPlan`. */
export const GenerateWeeklyPlanInputSchema = z.object({
  householdId: z.string().min(1),
  weekStart: IsoDateSchema,
  /** Contraintes ponctuelles saisies dans l'app, en texte libre. */
  notes: z.string().max(500).optional(),
  /** Régénère en écrasant un plan existant pour cette semaine. */
  force: z.boolean().optional(),
  /** Nombre de plats à préparer le dimanche, choisi avant la génération. */
  batchRecipeCount: z.number().int().min(3).max(6),
});

export const GenerateWeeklyPlanResultSchema = z.object({
  weekId: WeekIdSchema,
  recipeCount: z.number().int().min(0),
  itemCount: z.number().int().min(0),
});

/**
 * Style du plat demandé lors d'un remplacement.
 *
 * `one-pot` impose un plat rapide en une seule casserole, quel que soit le
 * jour ; `elaborate` laisse le champ libre. Absent, le style se déduit du jour
 * — contraint en semaine, libre le week-end — ce qui est le comportement par
 * défaut de l'app.
 */
export const MealStyleSchema = z.enum(['one-pot', 'elaborate']);

/** Payload de la callable `regenerateMeal`. */
export const RegenerateMealInputSchema = z.object({
  householdId: z.string().min(1),
  weekId: WeekIdSchema,
  date: IsoDateSchema,
  slot: z.enum(['lunch', 'dinner']),
  style: MealStyleSchema.optional(),
  notes: z.string().max(500).optional(),
});

/**
 * Choix d'un repas sans passer par le modèle.
 *
 * Union discriminée plutôt qu'un `recipeId` optionnel : le schéma exige alors
 * l'identifiant exactement quand il a un sens, et le refuse sinon. Aucune
 * vérification manuelle après le parsing.
 */
export const SetMealChoiceSchema = z.discriminatedUnion('choice', [
  z.object({ choice: z.literal('batch'), recipeId: z.string().min(1) }),
  z.object({ choice: z.literal('eat-out') }),
]);

export const SetMealInputSchema = z.object({
  householdId: z.string().min(1),
  weekId: WeekIdSchema,
  date: IsoDateSchema,
  slot: z.enum(['lunch', 'dinner']),
  meal: SetMealChoiceSchema,
});

export const SetMealResultSchema = z.object({
  weekId: WeekIdSchema,
  /** Nul pour un repas pris à l'extérieur. */
  recipeId: z.string().min(1).nullable(),
  recipeName: z.string().min(1).nullable(),
  itemCount: z.number().int().min(0),
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
export type MealStyle = z.infer<typeof MealStyleSchema>;
export type RegenerateMealInput = z.infer<typeof RegenerateMealInputSchema>;
export type RegenerateMealResult = z.infer<typeof RegenerateMealResultSchema>;
export type SetMealChoice = z.infer<typeof SetMealChoiceSchema>;
export type SetMealInput = z.infer<typeof SetMealInputSchema>;
export type SetMealResult = z.infer<typeof SetMealResultSchema>;
