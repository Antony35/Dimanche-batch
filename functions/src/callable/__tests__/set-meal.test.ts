import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  findSwapCounterpart,
  paths,
  type GeneratedPlan,
  type SetMealInput,
} from '@dimanche-batch/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { clearFirestore } from '../../__tests__/emulator';
import {
  ALICE,
  HOUSEHOLD_ID,
  MODEL,
  WEEK_START,
  makeGeneratedRecipe,
  portion,
} from '../../__tests__/fixtures';
import { db } from '../../lib/firestore';
import {
  readPlanForEdit,
  readPlanRecipes,
  replaceMeal,
  setPlanMeal,
  swapPlanMeals,
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

/** Deux plats au batch pour la semaine. */
function basePlan(): GeneratedPlan {
  return {
    recipes: [curry, chili],
    batchRecipeSlugs: ['batch-curry', 'batch-chili'],
    days: [2, 3, 4, 5, 6].map((dayIndex) => {
      const slug = dayIndex <= 4 ? 'batch-curry' : 'batch-chili';
      return { dayIndex, lunch: portion(slug), dinner: portion(slug) };
    }),
  };
}

/**
 * Le batch, puis une tarte cuisinée le samedi soir. La génération ne décrit
 * plus le week-end : c'est le foyer qui le décide, par le même chemin qu'ici.
 */
async function seedPlan() {
  await writeWeeklyPlan({
    householdId: HOUSEHOLD_ID,
    weekStart: WEEK_START,
    generatedBy: ALICE,
    plan: basePlan(),
    model: MODEL,
  });
  await replaceMeal({
    householdId: HOUSEHOLD_ID,
    weekId: WEEK_START,
    date: SAMEDI,
    slot: 'dinner',
    recipe: tarte,
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

  it('pose un reste du batch de la semaine précédente, qui n’achète rien', () => {
    expect(
      toMeal(
        { choice: 'previous-leftover', recipeId: 'vieux-chili' },
        ['batch-curry'],
        ['vieux-chili'],
      ),
    ).toMatchObject({ recipeId: 'vieux-chili', kind: 'freezer-backup' });
  });

  it('refuse un reste qui ne vient pas du batch de la semaine précédente', () => {
    // Sans cette règle, n'importe quelle recette du foyer passerait pour déjà
    // cuisinée, et ses ingrédients ne seraient jamais achetés.
    expect(() =>
      toMeal({ choice: 'previous-leftover', recipeId: 'batch-curry' }, ['batch-curry'], []),
    ).toThrow(HttpsError);
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

describe('reste de la semaine précédente', () => {
  it('allège la liste de courses du plat dont on retire un repas', async () => {
    await seedPlan();
    const before = await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'lentilles-corail--mass'))
      .get();

    // Le curry sert six repas ; mardi soir on finit un reste de la semaine
    // dernière. On ne le choisit pas via `choose` pour poser l'identifiant tel
    // que la callable le poserait après vérification.
    const plan = await readPlanForEdit(HOUSEHOLD_ID, WEEK_START);
    const knownRecipes = await readPlanRecipes(HOUSEHOLD_ID, plan);
    await setPlanMeal({
      householdId: HOUSEHOLD_ID,
      plan,
      date: MARDI,
      slot: 'dinner',
      meal: toMeal({ choice: 'previous-leftover', recipeId: 'vieux-chili' }, plan.batchRecipeIds, [
        'vieux-chili',
      ]),
      recipeToWrite: null,
      knownRecipes,
    });

    const after = await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'lentilles-corail--mass'))
      .get();
    expect(after.get('qty')).toBeLessThan(before.get('qty'));
    // 500 g pour 12 portions : six repas en demandaient 500, cinq en demandent 416,7 -> 420.
    expect(after.get('qty')).toBe(420);
  });
});

describe('vider le dernier repas d’un plat du batch', () => {
  /** Curry lundi et mardi, chili mercredi midi seulement : le reste dehors. */
  async function seedShortChili() {
    await writeWeeklyPlan({
      householdId: HOUSEHOLD_ID,
      weekStart: WEEK_START,
      generatedBy: ALICE,
      plan: {
        recipes: [curry, chili],
        batchRecipeSlugs: ['batch-curry', 'batch-chili'],
        days: [2, 3, 4, 5, 6].map((dayIndex) => {
          const slug = dayIndex <= 3 ? 'batch-curry' : 'batch-chili';
          return { dayIndex, lunch: portion(slug), dinner: portion(slug) };
        }),
      },
      model: MODEL,
    });
    // On laisse au chili un seul repas, mercredi midi.
    for (const [date, slot] of [
      ['2026-09-16', 'dinner'],
      ['2026-09-17', 'lunch'],
      ['2026-09-17', 'dinner'],
      ['2026-09-18', 'lunch'],
      ['2026-09-18', 'dinner'],
    ] as const) {
      await choose(date, slot, { choice: 'eat-out' });
    }
  }

  it('retire le plat du batch et de la liste de courses', async () => {
    await seedShortChili();
    const before = await readPlanForEdit(HOUSEHOLD_ID, WEEK_START);
    expect(before.batchRecipeIds).toContain('batch-chili');

    await choose('2026-09-16', 'lunch', { choice: 'eat-out' });

    const plan = await readPlanForEdit(HOUSEHOLD_ID, WEEK_START);
    expect(plan.batchRecipeIds).toEqual(['batch-curry']);
    expect(plan.recipeIds).not.toContain('batch-chili');
    expect(await readItemIds()).not.toContain('haricot-rouge--mass');
  });

  it('ne retire pas un plat qui sert encore d’autres repas', async () => {
    await seedShortChili();
    await choose(MARDI, 'dinner', { choice: 'eat-out' });

    const plan = await readPlanForEdit(HOUSEHOLD_ID, WEEK_START);
    expect(plan.batchRecipeIds).toEqual(['batch-curry', 'batch-chili']);
  });
});

describe('échanger deux repas du batch', () => {
  it('garde la liste de courses identique et échange les deux créneaux', async () => {
    await seedPlan();
    const itemsBefore = (
      await db.collection(paths.groceryItems(HOUSEHOLD_ID, WEEK_START)).get()
    ).docs.map((doc) => [doc.id, doc.get('qty')]);

    const plan = await readPlanForEdit(HOUSEHOLD_ID, WEEK_START);
    // Chili lundi midi : le curry y est prévu, le chili vendredi soir cède sa place.
    const ref = { date: '2026-09-14', slot: 'lunch' as const };
    const counterpart = findSwapCounterpart(plan, ref, 'batch-chili', () => true);
    expect(counterpart).toEqual({ date: '2026-09-18', slot: 'dinner' });

    await swapPlanMeals({ householdId: HOUSEHOLD_ID, plan, first: ref, second: counterpart! });

    const itemsAfter = (
      await db.collection(paths.groceryItems(HOUSEHOLD_ID, WEEK_START)).get()
    ).docs.map((doc) => [doc.id, doc.get('qty')]);
    expect(itemsAfter).toEqual(itemsBefore);

    const days = (await db.doc(paths.weeklyPlan(HOUSEHOLD_ID, WEEK_START)).get()).get('days');
    expect(days[2].lunch.recipeId).toBe('batch-chili');
    expect(days[6].dinner.recipeId).toBe('batch-curry');
  });
});
