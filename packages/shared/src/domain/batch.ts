import type { Recipe } from '../schemas/recipe';
import type { IsoDate } from '../schemas/common';
import type { WeeklyPlan } from '../schemas/weekly-plan';
import { addDays, getWeekDates } from './week';

/**
 * Session de préparation du dimanche.
 *
 * Ce que l'écran de préparation affiche se déduit entièrement du plan : la
 * logique vit donc ici, pas dans le composant. Elle répond à trois questions —
 * quels plats, dans quel ordre, et lesquels partent au congélateur.
 */

/** Jours où un plat cuisiné dimanche aurait trop attendu au frigo. */
const LATE_DAY_INDEXES = [5, 6];

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
      needsFreezing: servedDayIndexes.some((day) => LATE_DAY_INDEXES.includes(day)),
    });
  }

  return {
    cookDate: addDays(plan.weekStart, 1),
    totalMinutes: recipes.reduce((total, entry) => total + entry.recipe.prepMinutes, 0),
    recipes,
  };
}
