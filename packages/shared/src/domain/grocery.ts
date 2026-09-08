import type { Aisle } from '../schemas/common';
import { AISLES } from '../schemas/common';
import type { GroceryItem } from '../schemas/grocery-list';
import type { Recipe } from '../schemas/recipe';
import type { WeeklyPlan } from '../schemas/weekly-plan';
import { dimensionOf, toBaseQuantity } from './units';

/**
 * Normalise un nom d'ingrédient pour servir de clé d'agrégation : minuscules,
 * accents retirés, espaces compactés. « Oignon Rouge » et « oignon rouge »
 * doivent tomber sur la même ligne de courses.
 */
export function normalizeIngredientName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function itemKey(name: string, unit: string): string {
  return `${normalizeIngredientName(name).replace(/[^a-z0-9]+/g, '-')}--${unit}`;
}

/**
 * Construit la liste de courses d'un plan.
 *
 * Seuls les repas `cooked` consomment des ingrédients : un midi marqué
 * `batch-leftover` réutilise une portion déjà achetée, et l'inclure reviendrait
 * à acheter la semaine en double. C'est la règle la plus importante du module.
 */
export function buildGroceryList(plan: WeeklyPlan, recipes: Recipe[]): GroceryItem[] {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const accumulator = new Map<string, GroceryItem>();

  for (const day of plan.days) {
    for (const meal of [day.lunch, day.dinner]) {
      if (meal.kind !== 'cooked' || meal.recipeId === null) continue;
      const recipe = recipesById.get(meal.recipeId);
      if (!recipe) continue;

      for (const ingredient of recipe.ingredients) {
        const base = toBaseQuantity(ingredient.qty, ingredient.unit);
        const key = itemKey(ingredient.name, dimensionOf(ingredient.unit));
        const existing = accumulator.get(key);

        if (existing) {
          existing.qty += base.qty;
          if (!existing.fromRecipeIds.includes(recipe.id)) {
            existing.fromRecipeIds.push(recipe.id);
          }
          continue;
        }

        accumulator.set(key, {
          id: key,
          name: normalizeIngredientName(ingredient.name),
          qty: base.qty,
          unit: base.unit,
          aisle: ingredient.aisle,
          checked: false,
          fromRecipeIds: [recipe.id],
        });
      }
    }
  }

  return sortGroceryItems([...accumulator.values()]);
}

/** Tri par ordre de parcours du magasin, puis alphabétique dans le rayon. */
export function sortGroceryItems(items: GroceryItem[]): GroceryItem[] {
  const aisleOrder = new Map(AISLES.map((aisle, index) => [aisle, index]));
  return [...items].sort((a, b) => {
    const orderA = aisleOrder.get(a.aisle) ?? AISLES.length;
    const orderB = aisleOrder.get(b.aisle) ?? AISLES.length;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, 'fr');
  });
}

export function groupByAisle(items: GroceryItem[]): Array<{ aisle: Aisle; items: GroceryItem[] }> {
  const groups = new Map<Aisle, GroceryItem[]>();
  for (const item of sortGroceryItems(items)) {
    const group = groups.get(item.aisle);
    if (group) group.push(item);
    else groups.set(item.aisle, [item]);
  }
  return [...groups.entries()].map(([aisle, groupItems]) => ({ aisle, items: groupItems }));
}

/**
 * Fusionne une liste régénérée avec l'existante en conservant les cases déjà
 * cochées. Sans ça, régénérer un repas le mercredi effacerait les courses
 * faites le lundi.
 */
export function mergePreservingChecked(
  next: GroceryItem[],
  previous: GroceryItem[],
): GroceryItem[] {
  const checkedIds = new Set(previous.filter((item) => item.checked).map((item) => item.id));
  return next.map((item) => ({ ...item, checked: checkedIds.has(item.id) }));
}
