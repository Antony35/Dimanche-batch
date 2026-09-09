import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { paths, type GeneratedPlan, type GeneratedRecipe } from '@dimanche-batch/shared';
import { clearFirestore } from '../../__tests__/emulator';
import { ALICE, HOUSEHOLD_ID, MODEL, WEEK_START, makeGeneratedRecipe } from '../../__tests__/fixtures';
import { db } from '../firestore';
import { PlanNotFoundError, replaceMeal, writeWeeklyPlan } from '../plan-writer';

/**
 * Remplacer un repas est la seule opération qui réécrit un plan sans le
 * régénérer. Ce qu'elle doit garantir tient en une phrase : la liste de
 * courses reflète exactement le nouveau menu, sans perdre ce qui reste vrai.
 */

const LUNDI = '2026-09-14';
const MARDI = '2026-09-15';

// Oignon est partagé par le curry et la soupe. C'est le cas qui distingue un
// recalcul complet d'un rapiéçage : retirer les ingrédients de la soupe ne
// doit pas emporter l'oignon, encore nécessaire au curry.
const curry = makeGeneratedRecipe({
  slug: 'batch-curry',
  name: 'Curry de lentilles',
  ingredients: [
    { name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' },
    { name: 'oignon', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
  ],
});

const soupe = makeGeneratedRecipe({
  slug: 'soupe-poireaux',
  name: 'Soupe de poireaux',
  ingredients: [
    { name: 'poireau', qty: 3, unit: 'piece', aisle: 'fruits-legumes' },
    { name: 'oignon', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
  ],
});

const chili = makeGeneratedRecipe({
  slug: 'chili-sin-carne',
  name: 'Chili sin carne',
  ingredients: [{ name: 'haricot rouge', qty: 400, unit: 'g', aisle: 'epicerie' }],
});

/** Curry le lundi et le dimanche soir, soupe le mardi soir, rien d'autre. */
function basePlan(): GeneratedPlan {
  const dinners: Array<string | null> = ['batch-curry', 'soupe-poireaux', null, null, null, null, 'batch-curry'];

  return {
    recipes: [curry, soupe],
    days: dinners.map((slug, dayIndex) => ({
      dayIndex,
      lunch: {
        recipeSlug: 'batch-curry',
        kind: 'batch-leftover' as const,
        withStarter: false,
        withDessert: false,
      },
      dinner: {
        recipeSlug: slug,
        kind: slug ? ('cooked' as const) : ('eat-out' as const),
        withStarter: false,
        withDessert: false,
      },
    })),
  };
}

async function seedPlan(plan: GeneratedPlan = basePlan()) {
  return writeWeeklyPlan({
    householdId: HOUSEHOLD_ID,
    weekStart: WEEK_START,
    generatedBy: ALICE,
    plan,
    model: MODEL,
  });
}

function swapMardiDinner(recipe: GeneratedRecipe = chili) {
  return replaceMeal({
    householdId: HOUSEHOLD_ID,
    weekId: WEEK_START,
    date: MARDI,
    slot: 'dinner',
    recipe,
  });
}

async function readPlan() {
  return db.doc(paths.weeklyPlan(HOUSEHOLD_ID, WEEK_START)).get();
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

describe('replaceMeal', () => {
  it('installe la nouvelle recette sur le seul créneau visé', async () => {
    await seedPlan();

    const result = await swapMardiDinner();
    expect(result.recipeId).toBe('chili-sin-carne');
    expect(result.recipeName).toBe('Chili sin carne');

    const days = (await readPlan()).get('days');
    expect(days[1].dinner.recipeId).toBe('chili-sin-carne');
    expect(days[1].dinner.kind).toBe('cooked');
    expect(days[1].lunch.recipeId).toBe('batch-curry');
    expect(days[0].dinner.recipeId).toBe('batch-curry');
  });

  it('crée le document de la nouvelle recette', async () => {
    await seedPlan();
    await swapMardiDinner();

    const recipe = await db.doc(paths.recipe(HOUSEHOLD_ID, 'chili-sin-carne')).get();
    expect(recipe.get('name')).toBe('Chili sin carne');
    expect(recipe.get('lastUsedAt')).toBe(WEEK_START);
  });

  it('retire les ingrédients propres à la recette écartée', async () => {
    await seedPlan();
    expect(await readItemIds()).toContain('poireau--piece');

    await swapMardiDinner();

    const ids = await readItemIds();
    expect(ids).not.toContain('poireau--piece');
    expect(ids).toContain('haricot-rouge--mass');
  });

  it('garde un ingrédient encore nécessaire à une autre recette', async () => {
    await seedPlan();
    await swapMardiDinner();

    // L'oignon vient aussi du curry, cuisiné lundi et dimanche : il reste.
    const oignon = await db.doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'oignon--piece')).get();
    expect(oignon.exists).toBe(true);
    expect(oignon.get('qty')).toBe(4); // 2 par curry, cuisiné deux fois
  });

  it('conserve les cases cochées des articles qui survivent', async () => {
    await seedPlan();
    await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'lentilles-corail--mass'))
      .update({ checked: true });

    await swapMardiDinner();

    const item = await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'lentilles-corail--mass'))
      .get();
    expect(item.get('checked')).toBe(true);
  });

  it('met `recipeIds` à jour sans décrocher une recette encore servie', async () => {
    await seedPlan();
    await swapMardiDinner();

    const recipeIds = (await readPlan()).get('recipeIds');
    expect(recipeIds).toContain('chili-sin-carne');
    expect(recipeIds).toContain('batch-curry');
    expect(recipeIds).not.toContain('soupe-poireaux');
  });

  it('ne réécrit pas les recettes que le remplacement ne touche pas', async () => {
    await seedPlan();
    const curryRef = db.doc(paths.recipe(HOUSEHOLD_ID, 'batch-curry'));
    await curryRef.update({ isFavorite: true, lastUsedAt: '2026-01-05' });

    await swapMardiDinner();

    const after = await curryRef.get();
    expect(after.get('isFavorite')).toBe(true);
    expect(after.get('lastUsedAt')).toBe('2026-01-05');
  });

  it('préserve `isFavorite` si la recette proposée est déjà connue du foyer', async () => {
    await seedPlan();
    await db.doc(paths.recipe(HOUSEHOLD_ID, 'soupe-poireaux')).update({ isFavorite: true });

    // Le modèle repropose la soupe sur un autre créneau.
    await replaceMeal({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_START,
      date: LUNDI,
      slot: 'dinner',
      recipe: soupe,
    });

    const after = await db.doc(paths.recipe(HOUSEHOLD_ID, 'soupe-poireaux')).get();
    expect(after.get('isFavorite')).toBe(true);
  });

  it('refuse une semaine sans plan enregistré', async () => {
    await expect(swapMardiDinner()).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it('refuse une date hors du plan', async () => {
    await seedPlan();
    await expect(
      replaceMeal({
        householdId: HOUSEHOLD_ID,
        weekId: WEEK_START,
        date: '2026-10-01',
        slot: 'dinner',
        recipe: chili,
      }),
    ).rejects.toThrow(/Aucun jour au 2026-10-01/);
  });
});
