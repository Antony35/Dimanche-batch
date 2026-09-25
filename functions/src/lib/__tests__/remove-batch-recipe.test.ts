import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GroceryItemSchema,
  WeeklyPlanSchema,
  makeManualGroceryItem,
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
  portion,
} from '../../__tests__/fixtures';
import { db } from '../firestore';
import { removeBatchRecipe, writeWeeklyPlan } from '../plan-writer';

/**
 * Retirer un plat du batch, c'est cuisiner moins parce que le frigo est plein.
 * Ce que ces tests protègent : le plat sort de la liste de courses **sans
 * emporter** ce qu'il partageait avec un autre, ni les cases cochées, ni les
 * articles ajoutés à la main — et rien n'est décompté.
 */

// L'oignon est partagé : le retirer avec le curry ferait sous-acheter le chili.
const curry = makeGeneratedRecipe({
  slug: 'batch-curry',
  name: 'Curry de lentilles',
  servings: 8,
  ingredients: [
    { name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' },
    { name: 'oignon', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
  ],
});

const chili = makeGeneratedRecipe({
  slug: 'chili-sin-carne',
  name: 'Chili sin carne',
  servings: 12,
  ingredients: [
    { name: 'haricot rouge', qty: 400, unit: 'g', aisle: 'epicerie' },
    { name: 'oignon', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
  ],
});

/** Curry lundi et mardi, chili du mercredi au vendredi. */
function basePlan(): GeneratedPlan {
  return {
    recipes: [curry, chili],
    batchRecipeSlugs: ['batch-curry', 'chili-sin-carne'],
    days: [2, 3, 4, 5, 6].map((dayIndex) => {
      const slug = dayIndex >= 4 ? 'chili-sin-carne' : 'batch-curry';
      return { dayIndex, lunch: portion(slug), dinner: portion(slug) };
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

const removeCurry = () =>
  removeBatchRecipe({ householdId: HOUSEHOLD_ID, weekId: WEEK_START, recipeId: 'batch-curry' });

beforeEach(clearFirestore);
afterAll(clearFirestore);

describe('removeBatchRecipe', () => {
  it('passe à décider les repas du plat et le sort du batch', async () => {
    await seedPlan();
    const result = await removeCurry();

    const plan = await readPlan();
    expect(result.mealCount).toBe(4);
    expect(plan.batchRecipeIds).toEqual(['chili-sin-carne']);
    expect(plan.recipeIds).not.toContain('batch-curry');
    expect(plan.days[2]?.lunch.kind).toBe('undecided');
    expect(plan.days[3]?.dinner.kind).toBe('undecided');
    expect(plan.days[4]?.lunch.recipeId).toBe('chili-sin-carne');
  });

  it('retire ses ingrédients sans emporter ceux qu’il partageait', async () => {
    await seedPlan();
    await removeCurry();

    const items = await readItems();
    const ids = items.map((item) => item.id);
    expect(ids).not.toContain('lentilles-corail--mass');
    expect(ids).toContain('haricot-rouge--mass');
    // Le chili sert six repas, soit toute sa recette : un oignon.
    expect(items.find((item) => item.id === 'oignon--piece')?.qty).toBe(1);
  });

  it('garde les cases cochées et les articles ajoutés à la main', async () => {
    await seedPlan();
    await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'haricot-rouge--mass'))
      .update({ checked: true });
    const manual = makeManualGroceryItem({
      name: 'sac poubelle',
      qty: 1,
      unit: 'piece',
      aisle: 'entretien',
    });
    const { id, ...data } = manual;
    await db.doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, id)).set(data);

    await removeCurry();

    const items = await readItems();
    expect(items.find((item) => item.id === 'haricot-rouge--mass')?.checked).toBe(true);
    expect(items.map((item) => item.id)).toContain(id);
  });

  it('ne consomme aucune génération', async () => {
    await seedPlan();
    const before = (await db.collection(paths.usage(HOUSEHOLD_ID)).get()).docs.map((doc) =>
      doc.data(),
    );
    await removeCurry();
    const after = (await db.collection(paths.usage(HOUSEHOLD_ID)).get()).docs.map((doc) =>
      doc.data(),
    );
    expect(after).toEqual(before);
  });
});
