import {
  GroceryItemSchema,
  RecipeSchema,
  WeeklyPlanSchema,
  buildGroceryList,
  getWeekDates,
  mergePreservingChecked,
  paths,
  replaceMealInPlan,
  type GeneratedMeal,
  type GeneratedPlan,
  type GeneratedRecipe,
  type GenerateWeeklyPlanResult,
  type GroceryItem,
  type GroceryList,
  type Meal,
  type MealSlot,
  type Recipe,
  type RegenerateMealResult,
  type SetMealResult,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import { PROMPT_VERSION } from '../gemini/prompt';
import { db } from './firestore';

export interface WritePlanParams {
  householdId: string;
  weekStart: string;
  generatedBy: string;
  plan: GeneratedPlan;
  model: string;
}

/** Ce que rend l'écriture d'un plan complet. Contrat de la callable. */
export type WritePlanResult = GenerateWeeklyPlanResult;

export interface ReplaceMealParams {
  householdId: string;
  weekId: string;
  date: string;
  slot: MealSlot;
  recipe: GeneratedRecipe;
}

/** Une régénération produit toujours une recette : les champs sont fermes. */
export type ReplaceMealResult = RegenerateMealResult;

/** Un repas posé peut n'en désigner aucune — le repas pris à l'extérieur. */
export type SetMealOutcome = SetMealResult;

export class PlanNotFoundError extends Error {
  constructor(weekId: string) {
    super(`Aucun plan enregistré pour la semaine du ${weekId}.`);
    this.name = 'PlanNotFoundError';
  }
}

/**
 * Matérialise un plan généré dans Firestore, en une seule écriture atomique.
 *
 * Le slug produit par le modèle devient l'identifiant du document recette.
 * C'est volontaire : une même recette proposée deux semaines de suite occupe
 * un seul document, dont on met à jour `lastUsedAt`, plutôt que de dupliquer.
 */
export async function writeWeeklyPlan(params: WritePlanParams): Promise<WritePlanResult> {
  const { householdId, weekStart, generatedBy, plan, model } = params;
  const weekId = weekStart;
  const dates = getWeekDates(weekStart);

  const existingRecipes = await readExistingRecipes(
    householdId,
    plan.recipes.map((recipe) => recipe.slug),
  );
  const recipes = plan.recipes.map((generated) =>
    toRecipe(generated, existingRecipes.get(generated.slug), weekStart),
  );
  const weeklyPlan = toWeeklyPlan(plan, { weekId, weekStart, dates, generatedBy, model });

  const { itemCount } = await commitPlan({
    householdId,
    plan: weeklyPlan,
    recipesToWrite: recipes,
    allRecipes: recipes,
  });

  return { weekId, recipeCount: recipes.length, itemCount };
}

/**
 * Remplace un seul repas d'un plan existant.
 *
 * Passe par le même `commitPlan` que la génération complète : la liste de
 * courses est intégralement recalculée, jamais rapiécée. Retirer à la main les
 * ingrédients de l'ancienne recette laisserait derrière tout ce qu'elle
 * partageait avec une autre recette de la semaine.
 */
export async function replaceMeal(params: ReplaceMealParams): Promise<ReplaceMealResult> {
  const { householdId, weekId, date, slot, recipe } = params;

  const current = await readPlanForEdit(householdId, weekId);
  const existing = await readPlanRecipes(householdId, current, [recipe.slug]);
  const nextRecipe = toRecipe(recipe, existing.get(recipe.slug), current.weekStart);

  const outcome = await setPlanMeal({
    householdId,
    plan: current,
    date,
    slot,
    meal: {
      recipeId: nextRecipe.id,
      kind: 'cooked',
      withStarter: false,
      withDessert: false,
    },
    recipeToWrite: nextRecipe,
    knownRecipes: existing,
  });

  // La recette vient d'être générée : elle existe, quoi qu'en dise le type
  // élargi de `setPlanMeal`, qui doit aussi couvrir le repas pris dehors.
  return {
    weekId: outcome.weekId,
    recipeId: nextRecipe.id,
    recipeName: nextRecipe.name,
    itemCount: outcome.itemCount,
  };
}

export interface SetPlanMealParams {
  householdId: string;
  plan: WeeklyPlan;
  date: string;
  slot: MealSlot;
  meal: Meal;
  /** Recette à persister — nulle quand le repas ne fait que pointer ailleurs. */
  recipeToWrite: Recipe | null;
  knownRecipes: Map<string, Recipe>;
}

/**
 * Pose un repas dans un plan et réécrit ce qui en dépend.
 *
 * Chemin unique pour toutes les modifications d'un repas, qu'elles viennent
 * d'une recette générée ou d'un simple choix de l'utilisateur : la liste de
 * courses est recalculée au même endroit, et les cases déjà cochées survivent
 * de la même façon.
 */
export async function setPlanMeal(params: SetPlanMealParams): Promise<SetMealOutcome> {
  const { householdId, plan, date, slot, meal, recipeToWrite, knownRecipes } = params;
  const nextPlan = replaceMealInPlan(plan, date, slot, meal);

  // Les recettes déjà en base servent au calcul des courses mais ne sont pas
  // réécrites : elles n'ont pas changé, et leur `lastUsedAt` non plus.
  const allRecipes = recipeToWrite
    ? [recipeToWrite, ...[...knownRecipes.values()].filter((r) => r.id !== recipeToWrite.id)]
    : [...knownRecipes.values()];

  const { itemCount } = await commitPlan({
    householdId,
    plan: nextPlan,
    recipesToWrite: recipeToWrite ? [recipeToWrite] : [],
    allRecipes,
  });

  const served = meal.recipeId ? (knownRecipes.get(meal.recipeId) ?? recipeToWrite) : null;
  return {
    weekId: plan.id,
    recipeId: served?.id ?? null,
    recipeName: served?.name ?? null,
    itemCount,
  };
}

/** Plan tel qu'il est en base, juste avant d'être modifié. */
export async function readPlanForEdit(householdId: string, weekId: string): Promise<WeeklyPlan> {
  const snapshot = await db.doc(paths.weeklyPlan(householdId, weekId)).get();
  if (!snapshot.exists) throw new PlanNotFoundError(weekId);

  const parsed = WeeklyPlanSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
  if (!parsed.success) throw new PlanNotFoundError(weekId);
  return parsed.data;
}

/**
 * Recettes nécessaires au recalcul des courses.
 *
 * Les plats du batch y figurent systématiquement, même si plus aucun repas ne
 * les sert : ils sont cuisinés le dimanche, donc achetés, et les oublier ferait
 * disparaître leurs ingrédients de la liste.
 */
export async function readPlanRecipes(
  householdId: string,
  plan: WeeklyPlan,
  extraIds: string[] = [],
): Promise<Map<string, Recipe>> {
  return readExistingRecipes(householdId, [
    ...plan.recipeIds,
    ...plan.batchRecipeIds,
    ...extraIds,
  ]);
}

interface CommitPlanParams {
  householdId: string;
  plan: WeeklyPlan;
  /** Recettes à persister. */
  recipesToWrite: Recipe[];
  /** Recettes nécessaires au calcul des courses, écrites ou déjà en base. */
  allRecipes: Recipe[];
}

/**
 * Écrit un plan, ses recettes et sa liste de courses en un seul batch.
 *
 * Tout part ensemble parce qu'un plan à moitié écrit est pire qu'un plan
 * absent : l'app afficherait un planning dont la liste de courses ne
 * correspondrait à rien.
 */
async function commitPlan(params: CommitPlanParams): Promise<{ itemCount: number }> {
  const { householdId, plan, recipesToWrite, allRecipes } = params;
  const weekId = plan.id;

  const items = buildGroceryList(plan, allRecipes);
  const previous = await readExistingGroceryItems(householdId, weekId);
  const mergedItems = mergePreservingChecked(items, previous.items);

  const batch = db.batch();

  for (const recipe of recipesToWrite) {
    const { id, ...data } = recipe;
    batch.set(db.doc(paths.recipe(householdId, id)), data, { merge: true });
  }

  // Les documents écrits sont typés par les schémas qui les décrivent :
  // ajouter un champ au schéma sans l'écrire ici devient une erreur de
  // compilation, au lieu d'un document incomplet découvert à la lecture.
  const planDocument: Omit<WeeklyPlan, 'id'> = {
    weekStart: plan.weekStart,
    days: plan.days,
    recipeIds: plan.recipeIds,
    batchRecipeIds: plan.batchRecipeIds,
    generatedAt: plan.generatedAt,
    generatedBy: plan.generatedBy,
    model: plan.model,
    promptVersion: plan.promptVersion ?? PROMPT_VERSION,
  };
  batch.set(db.doc(paths.weeklyPlan(householdId, weekId)), planDocument);

  const listDocument: Omit<GroceryList, 'id'> = {
    itemCount: mergedItems.length,
    generatedAt: Date.now(),
  };
  batch.set(db.doc(paths.groceryList(householdId, weekId)), listDocument);

  // Les articles disparus d'une régénération doivent partir : sinon la liste
  // garderait des ingrédients d'un repas qui n'est plus au menu.
  const nextIds = new Set(mergedItems.map((item) => item.id));
  for (const staleId of previous.ids) {
    if (!nextIds.has(staleId)) {
      batch.delete(db.doc(paths.groceryItem(householdId, weekId, staleId)));
    }
  }

  for (const item of mergedItems) {
    const { id, ...data } = item;
    batch.set(db.doc(paths.groceryItem(householdId, weekId, id)), data);
  }

  await batch.commit();

  return { itemCount: mergedItems.length };
}

/** Recettes déjà connues du foyer, pour préserver ce que l'utilisateur y a mis. */
async function readExistingRecipes(
  householdId: string,
  recipeIds: string[],
): Promise<Map<string, Recipe>> {
  const unique = [...new Set(recipeIds)];
  const snapshots = await Promise.all(
    unique.map((recipeId) => db.doc(paths.recipe(householdId, recipeId)).get()),
  );

  const existing = new Map<string, Recipe>();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const parsed = RecipeSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
    if (parsed.success) existing.set(parsed.data.id, parsed.data);
  }
  return existing;
}

interface ExistingGroceryItems {
  /** Articles exploitables, seuls porteurs d'un `checked` digne de confiance. */
  items: GroceryItem[];
  /** Tous les identifiants présents, valides ou non — base du nettoyage. */
  ids: string[];
}

/**
 * Un document illisible ne transmet pas son `checked`, mais reste candidat à
 * la suppression : l'ignorer complètement le laisserait orphelin dans la liste
 * pour toujours. D'où les deux sorties plutôt qu'une.
 */
async function readExistingGroceryItems(
  householdId: string,
  weekId: string,
): Promise<ExistingGroceryItems> {
  const snapshot = await db.collection(paths.groceryItems(householdId, weekId)).get();

  const items: GroceryItem[] = [];
  const ids: string[] = [];
  for (const doc of snapshot.docs) {
    ids.push(doc.id);
    const parsed = GroceryItemSchema.safeParse({ id: doc.id, ...doc.data() });
    if (parsed.success) items.push(parsed.data);
  }
  return { items, ids };
}

function toRecipe(
  generated: GeneratedRecipe,
  previous: Recipe | undefined,
  weekStart: string,
): Recipe {
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
    createdAt: previous?.createdAt ?? Date.now(),
  };
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
    batchRecipeIds: plan.batchRecipeSlugs,
    generatedAt: Date.now(),
    generatedBy: context.generatedBy,
    model: context.model,
    promptVersion: PROMPT_VERSION,
  };
}
