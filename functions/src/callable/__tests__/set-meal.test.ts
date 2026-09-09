import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { paths, type GeneratedPlan, type SetMealInput } from '@dimanche-batch/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { clearFirestore } from '../../__tests__/emulator';
import {
  ALICE,
  HOUSEHOLD_ID,
  MODEL,
  WEEK_START,
  makeGeneratedRecipe,
} from '../../__tests__/fixtures';
import { db } from '../../lib/firestore';
import {
  readPlanForEdit,
  readPlanRecipes,
  setPlanMeal,
  writeWeeklyPlan,
} from '../../lib/plan-writer';
import { toMeal } from '../set-meal';

/**
 * Choisir un repas soi-même ne passe pas par le modèle : ni appel Gemini, ni
 * quota consommé. Ce que ça touche en revanche, c'est la liste de courses —
 * d'où ces tests.
 */

const SAMEDI = '2026-09-12';
const MARDI = '2026-09-15';

const curry = makeGeneratedRecipe({
  slug: 'batch-curry',
  name: 'Curry de lentilles',
  servings: 12,
  ingredients: [{ name: 'lentilles corail', qty: 500, unit: 'g', aisle: 'epicerie' }],
});

const chili = makeGeneratedRecipe({
  slug: 'batch-chili',
  name: 'Chili sin carne',
  servings: 8,
  ingredients: [{ name: 'haricot rouge', qty: 400, unit: 'g', aisle: 'epicerie' }],
});

const tarte = makeGeneratedRecipe({
  slug: 'tarte-tomates',
  name: 'Tarte aux tomates',
  ingredients: [{ name: 'tomate', qty: 4, unit: 'piece', aisle: 'fruits-legumes' }],
});

/** Deux plats au batch pour la semaine, une tarte cuisinée le samedi soir. */
function basePlan(): GeneratedPlan {
  return {
    recipes: [curry, chili, tarte],
    batchRecipeSlugs: ['batch-curry', 'batch-chili'],
    days: [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
      if (dayIndex < 2) {
        return {
          dayIndex,
          lunch: {
            recipeSlug: null,
            kind: 'eat-out' as const,
            withStarter: false,
            withDessert: false,
          },
          dinner:
            dayIndex === 0
              ? {
                  recipeSlug: 'tarte-tomates',
                  kind: 'cooked' as const,
                  withStarter: false,
                  withDessert: false,
                }
              : {
                  recipeSlug: null,
                  kind: 'eat-out' as const,
                  withStarter: false,
                  withDessert: false,
                },
        };
      }

      const portion = {
        recipeSlug: dayIndex <= 4 ? 'batch-curry' : 'batch-chili',
        kind: 'batch-leftover' as const,
        withStarter: false,
        withDessert: false,
      };
      return { dayIndex, lunch: portion, dinner: { ...portion } };
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

/** Applique un choix comme le ferait la callable, sans son enveloppe `onCall`. */
async function choose(date: string, slot: 'lunch' | 'dinner', choice: SetMealInput['meal']) {
  const plan = await readPlanForEdit(HOUSEHOLD_ID, WEEK_START);
  const knownRecipes = await readPlanRecipes(HOUSEHOLD_ID, plan);

  return setPlanMeal({
    householdId: HOUSEHOLD_ID,
    plan,
    date,
    slot,
    meal: toMeal(choice, plan.batchRecipeIds),
    recipeToWrite: null,
    knownRecipes,
  });
}

async function readItemIds(): Promise<string[]> {
  const snapshot = await db.collection(paths.groceryItems(HOUSEHOLD_ID, WEEK_START)).get();
  return snapshot.docs.map((doc) => doc.id).sort();
}

beforeEach(async () => {
  await clearFirestore();
});

afterAll(async () => {
  await clearFirestore();
});

describe('toMeal', () => {
  it('sert une portion d’un plat du batch', () => {
    expect(toMeal({ choice: 'batch', recipeId: 'batch-curry' }, ['batch-curry'])).toEqual({
      recipeId: 'batch-curry',
      kind: 'batch-leftover',
      withStarter: false,
      withDessert: false,
    });
  });

  it('refuse un plat qui n’est pas au batch', () => {
    // Il n'a pas été cuisiné le dimanche, et ses ingrédients ne sont pas dans
    // la liste de courses : le servir promettrait un plat qui n'existe pas.
    expect(() => toMeal({ choice: 'batch', recipeId: 'tarte-tomates' }, ['batch-curry'])).toThrow(
      HttpsError,
    );
  });

  it('laisse un repas à l’extérieur sans recette', () => {
    const meal = toMeal({ choice: 'eat-out' }, []);
    expect(meal.recipeId).toBeNull();
    expect(meal.kind).toBe('eat-out');
  });
});

describe('choisir un repas', () => {
  it('installe la portion du batch sur le créneau visé', async () => {
    await seedPlan();

    const result = await choose(MARDI, 'dinner', { choice: 'batch', recipeId: 'batch-chili' });

    expect(result.recipeId).toBe('batch-chili');
    expect(result.recipeName).toBe('Chili sin carne');

    const days = (await db.doc(paths.weeklyPlan(HOUSEHOLD_ID, WEEK_START)).get()).get('days');
    expect(days[3].dinner.recipeId).toBe('batch-chili');
    expect(days[3].dinner.kind).toBe('batch-leftover');
  });

  it('ne change pas la liste de courses en passant d’un plat du batch à l’autre', async () => {
    // Les deux plats sont cuisinés dimanche : servir l'un plutôt que l'autre
    // ne modifie rien de ce qu'il faut acheter.
    await seedPlan();
    const before = await readItemIds();

    await choose(MARDI, 'dinner', { choice: 'batch', recipeId: 'batch-chili' });

    expect(await readItemIds()).toEqual(before);
  });

  it('retire les ingrédients d’un plat frais qu’on ne cuisine plus', async () => {
    await seedPlan();
    expect(await readItemIds()).toContain('tomate--piece');

    await choose(SAMEDI, 'dinner', { choice: 'eat-out' });

    expect(await readItemIds()).not.toContain('tomate--piece');
  });

  it('garde le batch intact quand on mange dehors en semaine', async () => {
    // Le batch est déjà cuisiné : sauter un repas ne le décuisine pas.
    await seedPlan();

    const result = await choose(MARDI, 'lunch', { choice: 'eat-out' });

    expect(result.recipeId).toBeNull();
    const ids = await readItemIds();
    expect(ids).toContain('lentilles-corail--mass');
    expect(ids).toContain('haricot-rouge--mass');
  });

  it('conserve les cases déjà cochées', async () => {
    await seedPlan();
    await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'lentilles-corail--mass'))
      .update({ checked: true });

    await choose(MARDI, 'dinner', { choice: 'batch', recipeId: 'batch-chili' });

    const item = await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'lentilles-corail--mass'))
      .get();
    expect(item.get('checked')).toBe(true);
  });

  it('ne consomme aucune génération', async () => {
    // Choisir soi-même n'appelle pas le modèle : rien à décompter.
    await seedPlan();
    await choose(MARDI, 'dinner', { choice: 'batch', recipeId: 'batch-chili' });

    const usage = await db.collection(paths.usage(HOUSEHOLD_ID)).get();
    expect(usage.empty).toBe(true);
  });
});
