import type { Aisle, Unit, WeekId } from '../schemas/common';
import { AISLES } from '../schemas/common';
import type { GroceryItem, GroceryOrigin, ManualItem } from '../schemas/grocery-list';
import type { Recipe } from '../schemas/recipe';
import type { WeeklyPlan } from '../schemas/weekly-plan';
import { getBatchPortions } from './batch';
import { SERVINGS_PER_MEAL } from './plan-constraints';
import { normalizeName } from './text';
import { dimensionOf, roundUpQuantity, toBaseQuantity } from './units';

/** Nom d'ingrédient ramené à sa clé d'agrégation. */
export function normalizeIngredientName(name: string): string {
  return normalizeName(name);
}

/**
 * Clé d'un ingrédient : nom normalisé et dimension d'unité. Partagée par la
 * liste de courses et la mise en place du batch — deux clés qui doivent
 * coïncider finiraient par diverger, et les deux écrans ne reconnaîtraient
 * plus le même oignon.
 */
export function ingredientKey(name: string, unit: string): string {
  return `${normalizeIngredientName(name).replace(/[^a-z0-9]+/g, '-')}--${unit}`;
}

/** L'origine la plus forte l'emporte : un article du batch le reste. */
const ORIGIN_RANK: Record<GroceryOrigin, number> = { batch: 2, fresh: 1, manual: 0 };

function strongerOrigin(a: GroceryOrigin, b: GroceryOrigin): GroceryOrigin {
  return ORIGIN_RANK[a] >= ORIGIN_RANK[b] ? a : b;
}

/**
 * Verse les ingrédients d'une recette dans l'accumulateur, mis à l'échelle.
 *
 * `portions` est ce qu'on va réellement cuisiner, et non ce que la recette
 * déclare : un plat conçu pour huit portions mais qui ne sert plus que trois
 * repas s'achète pour six. La recette, elle, n'est jamais réécrite — son
 * document est partagé entre les semaines et sert l'historique.
 *
 * Les quantités restent en flottant à ce stade. L'arrondi n'a lieu qu'une fois,
 * sur le total agrégé : arrondir ici empilerait un demi-pas par recette, et
 * quatre plats du batch suffiraient à acheter un oignon de trop.
 */
function addRecipeIngredients(
  accumulator: Map<string, GroceryItem>,
  recipe: Recipe,
  portions: number,
  origin: GroceryOrigin,
): void {
  const factor = portions / recipe.servings;

  for (const ingredient of recipe.ingredients) {
    const base = toBaseQuantity(ingredient.qty * factor, ingredient.unit);
    const key = ingredientKey(ingredient.name, dimensionOf(ingredient.unit));
    const existing = accumulator.get(key);

    if (existing) {
      existing.qty += base.qty;
      existing.origin = strongerOrigin(existing.origin, origin);
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
      origin,
      fromRecipeIds: [recipe.id],
    });
  }
}

/**
 * Construit la liste de courses d'un plan.
 *
 * **Un seul invariant : ce qui est acheté est ce qui est cuisiné.** Tout le
 * reste en découle.
 *
 * 1. **Les plats du batch**, comptés une fois chacun, au prorata des repas
 *    qu'ils servent réellement — `getBatchPortions`, la même fonction que celle
 *    qui dit à l'écran du dimanche combien de portions préparer. Compter chaque
 *    repas achèterait la semaine dix fois ; compter les portions déclarées
 *    achèterait pour huit un plat qu'on ne sert plus que six fois.
 * 2. **Les repas cuisinés le jour même**, samedi et dimanche, pour deux
 *    portions par repas servi.
 *
 * Ce qui n'achète rien : un repas pris à l'extérieur, un créneau encore à
 * décider, et un reste d'une semaine précédente — celui-là a été acheté et
 * cuisiné une autre semaine.
 *
 * Un repas `cooked` qui citerait un plat du batch est ignoré : le plat est déjà
 * compté au titre du batch. La contrainte de génération l'interdit, mais un plan
 * édité repas par repas pourrait produire ce cas, et il ne doit pas coûter le
 * double.
 */
export function buildGroceryList(plan: WeeklyPlan, recipes: Recipe[]): GroceryItem[] {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const accumulator = new Map<string, GroceryItem>();
  const batchIds = new Set(plan.batchRecipeIds);

  for (const recipeId of batchIds) {
    const recipe = recipesById.get(recipeId);
    if (recipe)
      addRecipeIngredients(accumulator, recipe, getBatchPortions(plan, recipeId), 'batch');
  }

  // Un plat frais servi deux fois le même week-end se cuisine en double, donc
  // s'achète en double : on compte ses créneaux avant de verser ses ingrédients.
  const freshMeals = new Map<string, number>();
  for (const day of plan.days) {
    for (const meal of [day.lunch, day.dinner]) {
      if (meal.kind !== 'cooked' || meal.recipeId === null) continue;
      if (batchIds.has(meal.recipeId)) continue;
      freshMeals.set(meal.recipeId, (freshMeals.get(meal.recipeId) ?? 0) + 1);
    }
  }

  for (const [recipeId, meals] of freshMeals) {
    const recipe = recipesById.get(recipeId);
    if (recipe) {
      addRecipeIngredients(accumulator, recipe, meals * SERVINGS_PER_MEAL, 'fresh');
    }
  }

  // L'arrondi, une fois, à la fin, et toujours vers le haut.
  const items = [...accumulator.values()].map((item) => ({
    ...item,
    qty: roundUpQuantity(item.qty, item.unit),
  }));

  return sortGroceryItems(items);
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

/** Préfixe des articles ajoutés à la main. Voir `manualItemId`. */
const MANUAL_PREFIX = 'manual--';

/**
 * Identifiant d'un article ajouté à la main.
 *
 * Préfixé, et c'est ce qui rend la fonctionnalité tenable. D'abord parce que
 * rien ne collisionne : ajouter « courgette » à la main ne se confond pas avec
 * les courgettes que le batch demande, et la ligne du foyer ne se fait pas
 * écraser au prochain recalcul. Ensuite parce que la Security Rule peut borner
 * le client à ce seul espace de noms — il ne crée ni ne supprime que là.
 *
 * Dérivé du nom plutôt que tiré au hasard : ajouter deux fois le même article
 * met la ligne à jour au lieu d'en créer une seconde.
 */
export function manualItemId(name: string, unit: string): string {
  return `${MANUAL_PREFIX}${ingredientKey(name, unit)}`;
}

/**
 * Article ajouté à la main, prêt à écrire.
 *
 * La quantité est ramenée en unité de base, comme l'agrégation le fait : sans
 * quoi « 1 kg de farine » et les 300 g d'une recette tomberaient sur des lignes
 * aux nombres incomparables. Le nom est normalisé comme ceux des recettes.
 */
export function makeManualGroceryItem(input: {
  name: string;
  qty: number;
  unit: Unit;
  aisle: Aisle;
}): GroceryItem {
  const base = toBaseQuantity(input.qty, input.unit);
  return {
    id: manualItemId(input.name, dimensionOf(input.unit)),
    name: normalizeIngredientName(input.name),
    qty: base.qty,
    unit: base.unit,
    aisle: input.aisle,
    checked: false,
    origin: 'manual',
    fromRecipeIds: [],
  };
}

/** Article manuel du foyer, saisi dans la liste de `weekId`. */
export function makeManualItem(input: {
  name: string;
  qty: number;
  unit: Unit;
  aisle: Aisle;
  weekId: WeekId;
}): ManualItem {
  const { id, name, qty, unit, aisle } = makeManualGroceryItem(input);
  return { id, name, qty, unit, aisle, addedWeekId: input.weekId, checkedWeekId: null };
}

/**
 * Les articles manuels tels que la liste d'une semaine les montre.
 *
 * Présent à partir de la semaine où il a été saisi, et jusqu'à celle où il a
 * été rayé, incluse : on doit le voir coché dans le magasin où on l'a pris.
 * Coché aussi dans les semaines d'avant qui l'affichent encore — la case est
 * celle de l'article, pas d'une semaine, et les deux onglets doivent dire la
 * même chose. Les identifiants de semaine sont des dates ISO : l'ordre
 * alphabétique est l'ordre chronologique.
 */
export function manualItemsForWeek(items: ManualItem[], weekId: WeekId): GroceryItem[] {
  return items
    .filter((item) => item.addedWeekId <= weekId)
    .filter((item) => item.checkedWeekId === null || weekId <= item.checkedWeekId)
    .map((item) => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      aisle: item.aisle,
      checked: item.checkedWeekId !== null,
      origin: 'manual' as const,
      fromRecipeIds: [],
    }));
}

/**
 * La liste d'une semaine : ses articles, plus les articles manuels du foyer.
 *
 * Un article manuel de l'ancienne forme — rangé dans la semaine — et un
 * article du foyer de même nom ne font qu'une ligne : celle du foyer, qui est
 * la seule qu'on écrit encore.
 */
export function withManualItems(
  weekItems: GroceryItem[],
  manualItems: ManualItem[],
  weekId: WeekId,
): GroceryItem[] {
  const standing = manualItemsForWeek(manualItems, weekId);
  const standingIds = new Set(standing.map((item) => item.id));
  return sortGroceryItems([...weekItems.filter((item) => !standingIds.has(item.id)), ...standing]);
}

/**
 * Fusionne une liste recalculée avec celle qui est en base.
 *
 * Deux choses à faire survivre à un recalcul, et le recalcul est intégral à
 * chaque modification d'un repas :
 *
 * 1. **les cases cochées** — sans quoi régénérer un repas le mercredi
 *    effacerait les courses faites le lundi ;
 * 2. **les articles ajoutés à la main** — ils ne sortent d'aucune recette, donc
 *    aucun recalcul ne les reproduit. Sans ce report, poser un repas le samedi
 *    effacerait le sac poubelle, et l'écrivain supprime tout article absent de
 *    la liste qu'on lui rend.
 */
export function mergeGroceryLists(next: GroceryItem[], previous: GroceryItem[]): GroceryItem[] {
  const checkedIds = new Set(previous.filter((item) => item.checked).map((item) => item.id));
  const nextIds = new Set(next.map((item) => item.id));

  const kept = previous.filter((item) => item.origin === 'manual' && !nextIds.has(item.id));

  return sortGroceryItems([
    ...next.map((item) => ({ ...item, checked: checkedIds.has(item.id) })),
    ...kept,
  ]);
}
