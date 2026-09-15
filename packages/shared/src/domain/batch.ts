import type { Ingredient, Recipe } from '../schemas/recipe';
import type { IsoDate } from '../schemas/common';
import type { WeeklyPlan } from '../schemas/weekly-plan';
import { SERVINGS_PER_MEAL } from './plan-constraints';
import { roundUpQuantity } from './units';
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
   * Portions à cuisiner. Celles qu'on a achetées, pas celles que la recette
   * déclare : voir `getBatchPortions`.
   */
  portions: number;
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
      portions: getBatchPortions(plan, recipeId),
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

/**
 * Repas de la semaine réellement servis par un plat du batch.
 *
 * Ne comptent que les portions du batch : un repas pris à l'extérieur ne mange
 * rien, et un reste d'une semaine précédente (`freezer-backup`) a été acheté et
 * cuisiné une autre semaine. Distinct de `countMealsServing`, qui compte les
 * créneaux quel qu'en soit le type — c'est ce qu'il faut pour annoncer combien
 * de repas un remplacement va toucher, jamais pour décider quoi acheter.
 */
export function countBatchMealsServing(plan: WeeklyPlan, recipeId: string): number {
  let count = 0;
  for (const day of plan.days) {
    for (const meal of [day.lunch, day.dinner]) {
      if (meal.kind === 'batch-leftover' && meal.recipeId === recipeId) count += 1;
    }
  }
  return count;
}

/**
 * Portions à cuisiner pour un plat du batch — **et donc à acheter**.
 *
 * Seule autorité du dépôt sur la question. La liste de courses et l'écran du
 * dimanche l'appellent tous les deux, ce qui rend « ce qui est acheté est ce
 * qui est cuisiné » vrai par construction plutôt que par vigilance. Les deux
 * l'ont lue ailleurs autrefois, et c'est précisément ainsi qu'on achetait pour
 * huit un plat qu'on ne servait plus que six fois.
 *
 * Le plancher d'un repas n'est pas une commodité : un plat du batch est cuisiné
 * le dimanche, donc acheté, même si l'utilisateur a vidé tous les créneaux qu'il
 * occupait. L'interface interdit d'en arriver là — on remplace le plat plutôt
 * que de le vider — mais un plan écrit avant cette règle peut exister, et il ne
 * doit pas se traduire par une liste de courses qui oublie un plat entier.
 */
export function getBatchPortions(plan: WeeklyPlan, recipeId: string): number {
  return Math.max(1, countBatchMealsServing(plan, recipeId)) * SERVINGS_PER_MEAL;
}

/**
 * Ingrédients d'une recette pour le nombre de portions qu'on cuisine
 * réellement.
 *
 * La recette déclare ses quantités pour ses propres portions ; quand un repas
 * est passé au reste ou dehors, le dimanche en cuisine moins, et l'écran doit
 * dire les quantités de la liste de courses, pas celles de la recette. Arrondi
 * vers le haut, comme les courses : on ne manque jamais.
 */
export function scaleIngredients(recipe: Recipe, portions: number): Ingredient[] {
  if (portions === recipe.servings) return recipe.ingredients;
  const factor = portions / recipe.servings;
  return recipe.ingredients.map((ingredient) => ({
    ...ingredient,
    qty: roundUpQuantity(ingredient.qty * factor, ingredient.unit),
  }));
}

/**
 * Ordre des fiches de cuisson : du plus long au plus court.
 *
 * Le plat qui mijote deux heures se lance en premier, et c'est pendant sa
 * cuisson qu'on prépare les autres. À cuisson égale, le plus long à préparer
 * d'abord ; à égalité parfaite, l'ordre du batch.
 */
export function orderForCooking<T extends { recipe: Pick<Recipe, 'cookMinutes' | 'prepMinutes'> }>(
  entries: readonly T[],
): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        b.entry.recipe.cookMinutes - a.entry.recipe.cookMinutes ||
        b.entry.recipe.prepMinutes - a.entry.recipe.prepMinutes ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}
