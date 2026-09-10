import type { Recipe } from '../schemas/recipe';
import type { IsoDate } from '../schemas/common';
import type { WeeklyPlan } from '../schemas/weekly-plan';
import { addDays, getWeekDates, requiresFreezing, BATCH_DAY_INDEX } from './week';

/**
 * Session de préparation du dimanche.
 *
 * Ce que l'écran de préparation affiche se déduit entièrement du plan : la
 * logique vit donc ici, pas dans le composant. Elle répond à trois questions —
 * quels plats, dans quel ordre, et lesquels partent au congélateur.
 */

export interface BatchRecipe {
  recipe: Recipe;
  /** Index des jours où ce plat est servi, 0 = samedi. */
  servedDayIndexes: number[];
  /**
   * Vrai si le plat est servi jeudi ou vendredi : cuisiné dimanche, il aurait
   * passé cinq jours au frigo. L'app dit alors de le congeler et de le sortir
   * la veille.
   */
  needsFreezing: boolean;
}

export interface BatchSession {
  /** Le dimanche, deuxième jour de la semaine. */
  cookDate: IsoDate;
  /** Somme des temps de préparation, pour dimensionner l'après-midi. */
  totalMinutes: number;
  /** Plats dans l'ordre où le modèle a demandé de les préparer. */
  recipes: BatchRecipe[];
}

export function getBatchSession(plan: WeeklyPlan, recipesById: Map<string, Recipe>): BatchSession {
  const dates = getWeekDates(plan.weekStart);
  const servedByRecipe = new Map<string, number[]>();

  plan.days.forEach((day) => {
    const dayIndex = dates.indexOf(day.date);
    if (dayIndex === -1) return;

    for (const meal of [day.lunch, day.dinner]) {
      if (meal.kind !== 'batch-leftover' || meal.recipeId === null) continue;
      const served = servedByRecipe.get(meal.recipeId) ?? [];
      if (!served.includes(dayIndex)) served.push(dayIndex);
      servedByRecipe.set(meal.recipeId, served);
    }
  });

  const recipes: BatchRecipe[] = [];
  for (const recipeId of plan.batchRecipeIds) {
    const recipe = recipesById.get(recipeId);
    // Un plat dont la recette manque n'est pas affichable : mieux vaut ne rien
    // montrer qu'une ligne vide au milieu d'une session de cuisine.
    if (!recipe) continue;

    const servedDayIndexes = (servedByRecipe.get(recipeId) ?? []).sort((a, b) => a - b);
    recipes.push({
      recipe,
      servedDayIndexes,
      needsFreezing: servedDayIndexes.some(requiresFreezing),
    });
  }

  return {
    cookDate: addDays(plan.weekStart, BATCH_DAY_INDEX),
    totalMinutes: recipes.reduce((total, entry) => total + entry.recipe.prepMinutes, 0),
    recipes,
  };
}

/**
 * Plats à sortir du congélateur ce soir.
 *
 * L'écran de préparation dit déjà « sortir la veille », mais il le dit le
 * dimanche, pour un plat qu'on mange jeudi : l'information arrive trois jours
 * trop tôt, à quelqu'un qui a les mains dans la farine. Elle est utile le
 * mercredi soir, sur l'écran qu'on ouvre le soir.
 *
 * On ne regarde que les plats servis **demain**, et seulement si demain tombe
 * un jour qui impose la congélation : un plat servi mercredi sortait du frigo,
 * même s'il porte l'étiquette parce qu'il est aussi servi vendredi.
 */
export function getThawReminders(
  plan: WeeklyPlan,
  recipesById: Map<string, Recipe>,
  today: IsoDate,
): Recipe[] {
  const dates = getWeekDates(plan.weekStart);
  const todayIndex = dates.indexOf(today);
  if (todayIndex === -1) return [];

  const tomorrowIndex = todayIndex + 1;
  const tomorrow = plan.days[tomorrowIndex];
  if (!tomorrow || !requiresFreezing(tomorrowIndex)) return [];

  const batchIds = new Set(plan.batchRecipeIds);
  const reminders = new Map<string, Recipe>();

  for (const meal of [tomorrow.lunch, tomorrow.dinner]) {
    if (meal.kind !== 'batch-leftover' || meal.recipeId === null) continue;
    if (!batchIds.has(meal.recipeId)) continue;
    const recipe = recipesById.get(meal.recipeId);
    if (recipe) reminders.set(recipe.id, recipe);
  }

  return [...reminders.values()];
}
