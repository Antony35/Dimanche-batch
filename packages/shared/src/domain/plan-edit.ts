import type { IsoDate } from '../schemas/common';
import type { Meal, MealSlot, WeeklyPlan } from '../schemas/weekly-plan';

/**
 * Édition d'un plan existant, sans passer par une régénération complète.
 *
 * Pur et hors de la Cloud Function à dessein : ce que remplacer un repas
 * implique — le repas lui-même, mais aussi la liste des recettes référencées —
 * se raisonne et se teste mieux ici qu'au milieu d'un batch Firestore.
 */

export class MealNotFoundError extends Error {
  constructor(date: string) {
    super(`Aucun jour au ${date} dans ce plan.`);
    this.name = 'MealNotFoundError';
  }
}

/**
 * Remplace un repas et rend un plan neuf.
 *
 * `recipeIds` est recalculé depuis les jours plutôt que corrigé au coup par
 * coup : la recette écartée peut très bien rester servie ailleurs dans la
 * semaine, et la retirer aveuglément casserait la requête qui charge les
 * recettes du plan en une fois.
 *
 * Les plats du batch y sont réunis systématiquement. Un plat cuisiné dimanche
 * reste acheté même si plus aucun repas ne le sert — l'utilisateur a pu changer
 * les derniers créneaux qui l'utilisaient. Sans cette union, il sortirait de
 * `recipeIds`, la fonction qui recharge les recettes ne le trouverait plus, et
 * ses ingrédients disparaîtraient de la liste de courses sans le moindre
 * message : le foyer sous-achèterait.
 */
export function replaceMealInPlan(
  plan: WeeklyPlan,
  date: IsoDate,
  slot: MealSlot,
  meal: Meal,
): WeeklyPlan {
  if (!plan.days.some((day) => day.date === date)) throw new MealNotFoundError(date);

  const days = plan.days.map((day) => (day.date === date ? { ...day, [slot]: meal } : day));
  return {
    ...plan,
    days,
    recipeIds: [...new Set([...collectRecipeIds(days), ...plan.batchRecipeIds])],
  };
}

/** Recettes citées par au moins un repas, dans l'ordre où elles apparaissent. */
export function collectRecipeIds(days: WeeklyPlan['days']): string[] {
  const ids = new Set<string>();
  for (const day of days) {
    for (const meal of [day.lunch, day.dinner]) {
      if (meal.recipeId !== null) ids.add(meal.recipeId);
    }
  }
  return [...ids];
}

/** Repas occupant un créneau donné, ou `null` si la date n'est pas dans le plan. */
export function findMeal(plan: WeeklyPlan, date: IsoDate, slot: MealSlot): Meal | null {
  return plan.days.find((day) => day.date === date)?.[slot] ?? null;
}

export class BatchRecipeNotFoundError extends Error {
  constructor(recipeId: string) {
    super(`Le plat « ${recipeId} » ne fait pas partie du batch de cette semaine.`);
    this.name = 'BatchRecipeNotFoundError';
  }
}

/**
 * Remplace un plat du batch, et tous les repas qu'il servait avec lui.
 *
 * L'ordre des trois opérations n'est pas indifférent. `batchRecipeIds` doit
 * être réécrit **avant** que `recipeIds` ne soit recalculé : ce dernier réunit
 * les plats du batch, donc laisser l'ancien slug dedans le maintiendrait dans
 * `recipeIds`, et `buildGroceryList` continuerait d'acheter ses ingrédients
 * pour un plat que plus personne ne cuisine.
 *
 * La position dans `batchRecipeIds` est conservée : c'est elle qui donne son
 * ordre à la session du dimanche.
 *
 * Les repas gardent leur `kind`. Un plat du batch servi en portion le reste ;
 * si une édition antérieure l'avait posé en `cooked`, le remplaçant hérite de
 * cette bizarrerie plutôt que d'en introduire une autre.
 */
export function replaceBatchRecipeInPlan(
  plan: WeeklyPlan,
  oldRecipeId: string,
  newRecipeId: string,
): WeeklyPlan {
  if (!plan.batchRecipeIds.includes(oldRecipeId)) {
    throw new BatchRecipeNotFoundError(oldRecipeId);
  }

  const batchRecipeIds = plan.batchRecipeIds.map((id) => (id === oldRecipeId ? newRecipeId : id));

  const days = plan.days.map((day) => ({
    ...day,
    lunch: swapRecipe(day.lunch, oldRecipeId, newRecipeId),
    dinner: swapRecipe(day.dinner, oldRecipeId, newRecipeId),
  }));

  return {
    ...plan,
    days,
    batchRecipeIds,
    recipeIds: [...new Set([...collectRecipeIds(days), ...batchRecipeIds])],
  };
}

function swapRecipe(meal: Meal, oldRecipeId: string, newRecipeId: string): Meal {
  return meal.recipeId === oldRecipeId ? { ...meal, recipeId: newRecipeId } : meal;
}

/** Créneaux servis par un plat, pour dire combien de repas un remplacement touche. */
export function countMealsServing(plan: WeeklyPlan, recipeId: string): number {
  let count = 0;
  for (const day of plan.days) {
    for (const meal of [day.lunch, day.dinner]) {
      if (meal.recipeId === recipeId) count += 1;
    }
  }
  return count;
}
