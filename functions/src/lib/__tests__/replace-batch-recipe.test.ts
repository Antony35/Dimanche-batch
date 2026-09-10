import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GroceryItemSchema,
  WeeklyPlanSchema,
  paths,
  type GeneratedPlan,
} from '@dimanche-batch/shared';
import { clearFirestore } from '../../__tests__/emulator';
import {
  ALICE,
  HOUSEHOLD_ID,
  MODEL,
  WEEK_START,
  makeGeneratedRecipe,
} from '../../__tests__/fixtures';
import { db } from '../firestore';
import { replaceBatchRecipe, writeWeeklyPlan } from '../plan-writer';

/**
 * Remplacer un plat du batch touche plusieurs repas d'un coup, et c'est la
 * seule opération du dépôt qui mute `batchRecipeIds` sur un plan existant.
 *
 * Ce que ces tests protègent tient en une phrase : l'ancien plat doit
 * disparaître **de la liste de courses**. S'il restait dans `batchRecipeIds`,
 * il resterait dans `recipeIds`, et le foyer achèterait les ingrédients d'un
 * plat que plus personne ne cuisine — sans le moindre message.
 */

// Le curry et le chili partagent l'oignon : c'est ce qui distingue un recalcul
// complet d'un rapiéçage. Retirer le curry ne doit pas emporter l'oignon.
const curry = makeGeneratedRecipe({
  slug: 'batch-curry',
  name: 'Curry de lentilles',
  servings: 8,
  prepMinutes: 50,
  ingredients: [
    { name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' },
    { name: 'oignon', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
  ],
});

const chili = makeGeneratedRecipe({
  slug: 'chili-sin-carne',
  name: 'Chili sin carne',
  servings: 8,
  prepMinutes: 40,
  tags: ['congelable'],
  ingredients: [
    { name: 'haricot rouge', qty: 400, unit: 'g', aisle: 'epicerie' },
    { name: 'oignon', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
  ],
});

const tajine = makeGeneratedRecipe({
  slug: 'tajine-legumes',
  name: 'Tajine de légumes',
  servings: 8,
  prepMinutes: 55,
  ingredients: [{ name: 'courgette', qty: 3, unit: 'piece', aisle: 'fruits-legumes' }],
});

/** Curry lundi et mardi, chili jeudi et vendredi, week-end à l'extérieur. */
function basePlan(): GeneratedPlan {
  const portion = (slug: string) => ({
    recipeSlug: slug,
    kind: 'batch-leftover' as const,
    withStarter: false,
    withDessert: false,
  });
  const away = {
    recipeSlug: null,
    kind: 'eat-out' as const,
    withStarter: false,
    withDessert: false,
  };

  return {
    recipes: [curry, chili],
    batchRecipeSlugs: ['batch-curry', 'chili-sin-carne'],
    days: [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
      const slug = dayIndex >= 5 ? 'chili-sin-carne' : 'batch-curry';
      const meal = dayIndex < 2 || dayIndex === 4 ? away : portion(slug);
      return { dayIndex, lunch: meal, dinner: { ...meal } };
    }),
  };
}

async function seedPlan() {
  return writeWeeklyPlan({
    householdId: HOUSEHOLD_ID,
    weekStart: WEEK_START,
    generatedBy: ALICE,
    plan: basePlan(),
    model: MODEL,
  });
}

async function readPlan() {
  const snapshot = await db.doc(paths.weeklyPlan(HOUSEHOLD_ID, WEEK_START)).get();
  return WeeklyPlanSchema.parse({ id: snapshot.id, ...snapshot.data() });
}

async function readItems() {
  const snapshot = await db.collection(paths.groceryItems(HOUSEHOLD_ID, WEEK_START)).get();
  return snapshot.docs.map((doc) => GroceryItemSchema.parse({ id: doc.id, ...doc.data() }));
}

const swapCurry = () =>
  replaceBatchRecipe({
    householdId: HOUSEHOLD_ID,
    weekId: WEEK_START,
    recipeId: 'batch-curry',
    recipe: tajine,
  });

beforeEach(clearFirestore);
afterAll(clearFirestore);

describe('replaceBatchRecipe', () => {
  it('met à jour tous les repas que le plat servait', async () => {
    await seedPlan();
    const result = await swapCurry();

    const plan = await readPlan();
    const served = plan.days.flatMap((day) => [day.lunch.recipeId, day.dinner.recipeId]);

    expect(served.filter((id) => id === 'tajine-legumes')).toHaveLength(4);
    expect(served).not.toContain('batch-curry');
    expect(result.mealCount).toBe(4);
  });

  it('garde la position du plat dans l’ordre de préparation', async () => {
    await seedPlan();
    await swapCurry();

    expect((await readPlan()).batchRecipeIds).toEqual(['tajine-legumes', 'chili-sin-carne']);
  });

  it('ne touche pas aux repas des autres plats du batch', async () => {
    await seedPlan();
    await swapCurry();

    const plan = await readPlan();
    // Jeudi et vendredi servaient le chili : ils n'ont aucune raison de bouger.
    expect(plan.days[5]?.lunch.recipeId).toBe('chili-sin-carne');
    expect(plan.days[6]?.dinner.recipeId).toBe('chili-sin-carne');
  });

  // L'invariant central : sans lui, le foyer achète pour un plat fantôme.
  it('retire les ingrédients de l’ancien plat de la liste de courses', async () => {
    await seedPlan();
    await swapCurry();

    const names = (await readItems()).map((item) => item.name);
    expect(names).not.toContain('lentilles corail');
    expect(names).toContain('courgette');
  });

  // Le cas qui distingue un recalcul complet d'un rapiéçage.
  it('garde un ingrédient que l’autre plat du batch utilise encore', async () => {
    await seedPlan();
    await swapCurry();

    const oignon = (await readItems()).find((item) => item.name === 'oignon');
    // Le curry en demandait 2, le chili 1 : il reste celui du chili.
    expect(oignon?.qty).toBe(1);
  });

  it('préserve les cases déjà cochées des articles qui restent', async () => {
    await seedPlan();
    const items = await readItems();
    const oignon = items.find((item) => item.name === 'oignon');
    await db.doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, oignon!.id)).update({ checked: true });

    await swapCurry();

    const after = (await readItems()).find((item) => item.name === 'oignon');
    expect(after?.checked).toBe(true);
  });

  it('écrit la recette du remplaçant', async () => {
    await seedPlan();
    await swapCurry();

    const snapshot = await db.doc(paths.recipe(HOUSEHOLD_ID, 'tajine-legumes')).get();
    expect(snapshot.exists).toBe(true);
    expect(snapshot.get('name')).toBe('Tajine de légumes');
  });

  it('refuse un plat qui n’est pas au batch', async () => {
    await seedPlan();
    await expect(
      replaceBatchRecipe({
        householdId: HOUSEHOLD_ID,
        weekId: WEEK_START,
        recipeId: 'plat-inconnu',
        recipe: tajine,
      }),
    ).rejects.toThrow(/ne fait pas partie du batch/);
  });
});
