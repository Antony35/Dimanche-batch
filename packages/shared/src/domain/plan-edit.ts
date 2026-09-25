import type { IsoDate } from '../schemas/common';
import type { Meal, MealSlot, WeeklyPlan } from '../schemas/weekly-plan';
import { countBatchMealsServing } from './batch';
import { requiresFreezing } from './week';

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

/**
 * Retire un plat du batch : il ne sera ni cuisiné dimanche, ni acheté.
 *
 * Le cas qui l'impose : le frigo contient déjà de quoi tenir une partie de la
 * semaine, et le foyer veut cuisiner moins. Les repas que servait le plat
 * passent **à décider** — le foyer y posera un reste, un repas dehors ou une
 * portion d'un autre plat du batch —, plutôt que d'en choisir un à sa place.
 *
 * Même ordre que `replaceBatchRecipeInPlan`, pour la même raison :
 * `batchRecipeIds` est réécrit avant que `recipeIds` ne soit recalculé, sinon
 * le plat y resterait, et `buildGroceryList` l'achèterait encore.
 *
 * Retirer le dernier plat est permis : une semaine sans batch se vit de restes.
 */
export function removeBatchRecipeFromPlan(plan: WeeklyPlan, recipeId: string): WeeklyPlan {
  if (!plan.batchRecipeIds.includes(recipeId)) throw new BatchRecipeNotFoundError(recipeId);

  const batchRecipeIds = plan.batchRecipeIds.filter((id) => id !== recipeId);
  const release = (meal: Meal): Meal =>
    meal.kind === 'batch-leftover' && meal.recipeId === recipeId ? undecidedMeal() : meal;

  const days = plan.days.map((day) => ({
    ...day,
    lunch: release(day.lunch),
    dinner: release(day.dinner),
  }));

  return {
    ...plan,
    days,
    batchRecipeIds,
    recipeIds: [...new Set([...collectRecipeIds(days), ...batchRecipeIds])],
  };
}

/**
 * Un créneau à décider. Une fonction et non une constante : chaque repas du
 * plan est un objet à lui, qu'aucune édition ne doit partager avec un autre.
 */
export function undecidedMeal(): Meal {
  return { recipeId: null, kind: 'undecided', withStarter: false, withDessert: false };
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

/** Un créneau du plan : une date et un repas du jour. */
export interface MealSlotRef {
  date: IsoDate;
  slot: MealSlot;
}

/**
 * Vrai si ce créneau est le dernier repas que sert son plat du batch.
 *
 * Le vider sans rien faire d'autre laisserait un plat cuisiné le dimanche que
 * plus personne ne mange. Vider ce repas est donc un geste qui **retire le
 * plat du batch** (`removeBatchRecipeFromPlan`), annoncé comme tel par l'app ;
 * y servir un autre plat du batch reste refusé — l'échange fait la même chose
 * sans perdre de plat.
 */
export function isLastMealOfBatchDish(plan: WeeklyPlan, date: IsoDate, slot: MealSlot): boolean {
  const meal = findMeal(plan, date, slot);
  if (!meal || meal.kind !== 'batch-leftover' || meal.recipeId === null) return false;
  if (!plan.batchRecipeIds.includes(meal.recipeId)) return false;
  return countBatchMealsServing(plan, meal.recipeId) === 1;
}

/** Position d'un créneau dans la semaine : deux par jour, le midi d'abord. */
function slotPosition(plan: WeeklyPlan, ref: MealSlotRef): number {
  const dayIndex = plan.days.findIndex((day) => day.date === ref.date);
  return dayIndex * 2 + (ref.slot === 'lunch' ? 0 : 1);
}

/**
 * Le créneau qui cède sa place quand on veut manger `targetRecipeId` à la
 * place de ce qui est prévu en `ref` — ou `null` si l'échange est impossible.
 *
 * Les portions sont comptées : manger le chili mardi midi, c'est en retirer une
 * portion ailleurs. Le créneau choisi est **le plus éloigné dans la semaine**
 * de ceux qui servent le chili, et il reçoit en retour le plat qu'on a quitté.
 * Chaque plat sert donc le même nombre de repas qu'avant, et la liste de
 * courses ne change pas d'un gramme.
 *
 * Un échange ne doit pas envoyer en fin de semaine un plat qui ne se congèle
 * pas : ces créneaux-là sont sautés, et le suivant le plus éloigné est essayé.
 * L'interface ne propose que les échanges pour lesquels un créneau existe.
 */
export function findSwapCounterpart(
  plan: WeeklyPlan,
  ref: MealSlotRef,
  targetRecipeId: string,
  isFreezable: (recipeId: string) => boolean,
): MealSlotRef | null {
  const current = findMeal(plan, ref.date, ref.slot);
  if (!current || current.kind !== 'batch-leftover' || current.recipeId === null) return null;
  if (current.recipeId === targetRecipeId) return null;
  if (!plan.batchRecipeIds.includes(targetRecipeId)) return null;

  const movingRecipeId = current.recipeId;
  const refDayIndex = plan.days.findIndex((day) => day.date === ref.date);
  if (refDayIndex === -1) return null;
  // Le plat qu'on veut manger arrive sur ce jour : il doit pouvoir y attendre.
  if (requiresFreezing(refDayIndex) && !isFreezable(targetRecipeId)) return null;

  const origin = slotPosition(plan, ref);
  const candidates: { ref: MealSlotRef; dayIndex: number; distance: number }[] = [];

  plan.days.forEach((day, dayIndex) => {
    for (const slot of ['lunch', 'dinner'] as const) {
      const meal = day[slot];
      if (meal.kind !== 'batch-leftover' || meal.recipeId !== targetRecipeId) continue;
      const candidate = { date: day.date, slot };
      candidates.push({
        ref: candidate,
        dayIndex,
        distance: Math.abs(slotPosition(plan, candidate) - origin),
      });
    }
  });

  candidates.sort((a, b) => b.distance - a.distance);
  const legal = candidates.find(
    (candidate) => !requiresFreezing(candidate.dayIndex) || isFreezable(movingRecipeId),
  );
  return legal?.ref ?? null;
}

/** Plats du batch qu'on peut servir en `ref` par échange, dans l'ordre du batch. */
export function listSwapTargets(
  plan: WeeklyPlan,
  ref: MealSlotRef,
  isFreezable: (recipeId: string) => boolean,
): string[] {
  return plan.batchRecipeIds.filter(
    (recipeId) => findSwapCounterpart(plan, ref, recipeId, isFreezable) !== null,
  );
}

/** Échange les repas de deux créneaux. `recipeIds` ne change pas : les mêmes plats sont servis. */
export function swapMealsInPlan(plan: WeeklyPlan, a: MealSlotRef, b: MealSlotRef): WeeklyPlan {
  const mealA = findMeal(plan, a.date, a.slot);
  const mealB = findMeal(plan, b.date, b.slot);
  if (!mealA) throw new MealNotFoundError(a.date);
  if (!mealB) throw new MealNotFoundError(b.date);

  const days = plan.days.map((day) => {
    let next = day;
    if (day.date === a.date) next = { ...next, [a.slot]: mealB };
    if (day.date === b.date) next = { ...next, [b.slot]: mealA };
    return next;
  });
  return { ...plan, days };
}

/**
 * Repas encore à décider, sur toute la semaine.
 *
 * La génération laisse ainsi le samedi et le dimanche, et retirer un plat du
 * batch y laisse les jours qu'il servait. Tant qu'il en reste, l'accueil
 * demande de les décider **avant** les courses du samedi : ce qu'ils demandent
 * doit être acheté le matin même.
 */
export function countUndecidedMeals(plan: WeeklyPlan): number {
  return plan.days
    .flatMap((day) => [day.lunch, day.dinner])
    .filter((meal) => meal.kind === 'undecided').length;
}
