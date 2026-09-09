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
