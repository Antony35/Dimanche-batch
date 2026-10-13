import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GroceryItemSchema,
  RecipeSchema,
  SubstitutionError,
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
import { RecipeNotFoundError, substituteRecipeIngredient, writeWeeklyPlan } from '../plan-writer';

/**
 * Remplacer un ingrédient réécrit une recette que la liste de courses achète.
 * Ce que ces tests protègent : la liste suit le remplacement, ses cases cochées
 * survivent, la session du dimanche qui citait l'ancien ingrédient disparaît,
 * et le favori n'est pas perdu au passage.
 */

const curry = makeGeneratedRecipe({
  slug: 'batch-curry',
  name: 'Curry de poulet',
  servings: 10,
  ingredients: [
    { name: 'poulet', qty: 500, unit: 'g', aisle: 'boucherie' },
    { name: 'oignon', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
  ],
});

const chili = makeGeneratedRecipe({
  slug: 'chili-sin-carne',
  name: 'Chili sin carne',
  servings: 10,
  ingredients: [{ name: 'haricot rouge', qty: 400, unit: 'g', aisle: 'epicerie' }],
});

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
  await writeWeeklyPlan({
    householdId: HOUSEHOLD_ID,
    weekStart: WEEK_START,
    generatedBy: ALICE,
    plan: basePlan(),
    model: MODEL,
  });
}

async function readItemIds() {
  const snapshot = await db.collection(paths.groceryItems(HOUSEHOLD_ID, WEEK_START)).get();
  return snapshot.docs.map((doc) => GroceryItemSchema.parse({ id: doc.id, ...doc.data() }).id);
}

async function readCurry() {
  const snapshot = await db.doc(paths.recipe(HOUSEHOLD_ID, 'batch-curry')).get();
  return RecipeSchema.parse({ id: snapshot.id, ...snapshot.data() });
}

const substitute = (substituteName: string, weekIds = [WEEK_START], ingredientName = 'poulet') =>
  substituteRecipeIngredient({
    householdId: HOUSEHOLD_ID,
    recipeId: 'batch-curry',
    ingredientName,
    substitute: substituteName,
    weekIds,
  });

beforeEach(clearFirestore);
afterAll(clearFirestore);

describe('substituteRecipeIngredient', () => {
  it('réécrit la recette et la liste de courses de la semaine', async () => {
    await seedPlan();
    const { ingredient } = await substitute('Dinde');

    expect(ingredient).toEqual({
      name: 'dinde',
      qty: 500,
      unit: 'g',
      aisle: 'boucherie',
      originalName: 'poulet',
    });
    expect((await readCurry()).ingredients[0]?.name).toBe('dinde');

    const ids = await readItemIds();
    expect(ids).toContain('dinde--mass');
    expect(ids).not.toContain('poulet--mass');
    expect(ids).toContain('haricot-rouge--mass');
  });

  it('garde les cases cochées des autres articles et le favori', async () => {
    await seedPlan();
    await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'oignon--piece'))
      .update({ checked: true });
    await db.doc(paths.recipe(HOUSEHOLD_ID, 'batch-curry')).update({ isFavorite: true });

    await substitute('dinde');

    const oignon = await db.doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'oignon--piece')).get();
    expect(oignon.get('checked')).toBe(true);
    expect((await readCurry()).isFavorite).toBe(true);
  });

  it('efface la session de cuisson qui citait l’ancien ingrédient', async () => {
    await seedPlan();
    const session = db.doc(paths.batchSession(HOUSEHOLD_ID, WEEK_START));
    await session.set({ sourceRecipeIds: ['batch-curry', 'chili-sin-carne'] });

    await substitute('dinde');

    expect((await session.get()).exists).toBe(false);
  });

  it('réécrit la seule recette quand aucune liste ne l’achète', async () => {
    await seedPlan();
    await substitute('dinde', []);

    expect((await readCurry()).ingredients[0]?.name).toBe('dinde');
    // Rien n'a été recalculé : la semaine n'était pas concernée.
    expect(await readItemIds()).toContain('poulet--mass');
  });

  it('refuse un remplacement d’une autre catégorie sans rien écrire', async () => {
    await seedPlan();
    await expect(substitute('tofu')).rejects.toBeInstanceOf(SubstitutionError);
    expect((await readCurry()).ingredients[0]?.name).toBe('poulet');
  });

  it('signale une recette disparue', async () => {
    await expect(substitute('dinde')).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});
