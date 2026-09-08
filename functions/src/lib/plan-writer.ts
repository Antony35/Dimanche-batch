import {
  RecipeSchema,
  buildGroceryList,
  getWeekDates,
  mergePreservingChecked,
  paths,
  type GeneratedMeal,
  type GeneratedPlan,
  type GroceryItem,
  type Meal,
  type Recipe,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import { db } from './firestore';

export interface WritePlanParams {
  householdId: string;
  weekStart: string;
  generatedBy: string;
  plan: GeneratedPlan;
  model: string;
}

export interface WritePlanResult {
  weekId: string;
  recipeCount: number;
  itemCount: number;
}

/**
 * Matérialise un plan généré dans Firestore, en une seule écriture atomique.
 *
 * Le slug produit par le modèle devient l'identifiant du document recette.
 * C'est volontaire : une même recette proposée deux semaines de suite occupe
 * un seul document, dont on met à jour `lastUsedAt`, plutôt que de dupliquer.
 *
 * Tout part en batch parce qu'un plan à moitié écrit est pire qu'un plan
 * absent : l'app afficherait un planning dont la liste de courses ne
 * correspondrait à rien.
 */
export async function writeWeeklyPlan(params: WritePlanParams): Promise<WritePlanResult> {
  const { householdId, weekStart, generatedBy, plan, model } = params;
  const weekId = weekStart;
  const dates = getWeekDates(weekStart);

  const existingRecipes = await readExistingRecipes(householdId, plan);
  const recipes = toRecipes(plan, existingRecipes, weekStart);
  const weeklyPlan = toWeeklyPlan(plan, { weekId, weekStart, dates, generatedBy, model });

  const items = buildGroceryList(weeklyPlan, recipes);
  const previousItems = await readExistingGroceryItems(householdId, weekId);
  const mergedItems = mergePreservingChecked(items, previousItems);

  const batch = db.batch();

  for (const recipe of recipes) {
    const { id, ...data } = recipe;
    batch.set(db.doc(paths.recipe(householdId, id)), data, { merge: true });
  }

  batch.set(db.doc(paths.weeklyPlan(householdId, weekId)), {
    weekStart: weeklyPlan.weekStart,
    days: weeklyPlan.days,
    recipeIds: weeklyPlan.recipeIds,
    generatedAt: weeklyPlan.generatedAt,
    generatedBy: weeklyPlan.generatedBy,
    model: weeklyPlan.model,
  });

  batch.set(db.doc(paths.groceryList(householdId, weekId)), {
    itemCount: mergedItems.length,
    generatedAt: Date.now(),
  });

  // Les articles disparus d'une régénération doivent partir : sinon la liste
  // garderait des ingrédients d'un repas qui n'est plus au menu.
  const nextIds = new Set(mergedItems.map((item) => item.id));
  for (const previous of previousItems) {
    if (!nextIds.has(previous.id)) {
      batch.delete(db.doc(paths.groceryItem(householdId, weekId, previous.id)));
    }
  }

  for (const item of mergedItems) {
    const { id, ...data } = item;
    batch.set(db.doc(paths.groceryItem(householdId, weekId, id)), data);
  }

  await batch.commit();

  return { weekId, recipeCount: recipes.length, itemCount: mergedItems.length };
}

/** Recettes déjà connues du foyer, pour préserver ce que l'utilisateur y a mis. */
async function readExistingRecipes(
  householdId: string,
  plan: GeneratedPlan,
): Promise<Map<string, Recipe>> {
  const snapshots = await Promise.all(
    plan.recipes.map((recipe) => db.doc(paths.recipe(householdId, recipe.slug)).get()),
  );

  const existing = new Map<string, Recipe>();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const parsed = RecipeSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
    if (parsed.success) existing.set(parsed.data.id, parsed.data);
  }
  return existing;
}

async function readExistingGroceryItems(
  householdId: string,
  weekId: string,
): Promise<GroceryItem[]> {
  const snapshot = await db.collection(paths.groceryItems(householdId, weekId)).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as GroceryItem);
}

function toRecipes(
  plan: GeneratedPlan,
  existing: Map<string, Recipe>,
  weekStart: string,
): Recipe[] {
  const now = Date.now();
  return plan.recipes.map((generated) => {
    const previous = existing.get(generated.slug);
    return {
      id: generated.slug,
      name: generated.name,
      servings: generated.servings,
      prepMinutes: generated.prepMinutes,
      tags: generated.tags,
      ingredients: generated.ingredients,
      steps: generated.steps,
      lastUsedAt: weekStart,
      // Un favori le reste, et la date de découverte ne se réécrit pas.
      isFavorite: previous?.isFavorite ?? false,
      createdAt: previous?.createdAt ?? now,
    };
  });
}

function toWeeklyPlan(
  plan: GeneratedPlan,
  context: {
    weekId: string;
    weekStart: string;
    dates: string[];
    generatedBy: string;
    model: string;
  },
): WeeklyPlan {
  const byIndex = new Map(plan.days.map((day) => [day.dayIndex, day]));
  const referenced = new Set<string>();

  const days = context.dates.map((date, index) => {
    const day = byIndex.get(index);
    const toMeal = (meal: GeneratedMeal): Meal => {
      if (meal.recipeSlug) referenced.add(meal.recipeSlug);
      return {
        recipeId: meal.recipeSlug,
        kind: meal.kind,
        withStarter: meal.withStarter,
        withDessert: meal.withDessert,
      };
    };

    // `day` est toujours défini : validateGeneratedPlan a vérifié les 7 index.
    return { date, lunch: toMeal(day!.lunch), dinner: toMeal(day!.dinner) };
  });

  return {
    id: context.weekId,
    weekStart: context.weekStart,
    days,
    recipeIds: [...referenced],
    generatedAt: Date.now(),
    generatedBy: context.generatedBy,
    model: context.model,
  };
}
