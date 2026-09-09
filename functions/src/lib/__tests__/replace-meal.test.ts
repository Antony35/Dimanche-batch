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

// Semaine du samedi 12 au vendredi 18 septembre 2026.
const SAMEDI = '2026-09-12';
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

/**
 * Semaine type : le curry est le plat du batch, cuisiné dimanche et servi du
 * lundi au vendredi ; la soupe est cuisinée le samedi soir, seul repas frais.
 *
 * C'est cette structure qui rend les tests parlants : remplacer le samedi soir
 * doit faire bouger la liste de courses, remplacer un mardi ne le doit pas.
 */
function basePlan(): GeneratedPlan {
  return {
    recipes: [curry, soupe],
    batchRecipeSlugs: ['batch-curry'],
    days: [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => ({
      dayIndex,
      lunch:
        dayIndex >= 2
          ? {
              recipeSlug: 'batch-curry',
              kind: 'batch-leftover' as const,
              withStarter: false,
              withDessert: false,
            }
          : { recipeSlug: null, kind: 'eat-out' as const, withStarter: false, withDessert: false },
      dinner:
        dayIndex === 0
          ? {
              recipeSlug: 'soupe-poireaux',
              kind: 'cooked' as const,
              withStarter: false,
              withDessert: false,
            }
          : dayIndex >= 2
            ? {
                recipeSlug: 'batch-curry',
                kind: 'batch-leftover' as const,
                withStarter: false,
                withDessert: false,
              }
            : { recipeSlug: null, kind: 'eat-out' as const, withStarter: false, withDessert: false },
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

/** Remplace le seul repas cuisiné de la semaine : le samedi soir. */
function swapSamediDinner(recipe: GeneratedRecipe = chili) {
  return replaceMeal({
    householdId: HOUSEHOLD_ID,
    weekId: WEEK_START,
    date: SAMEDI,
    slot: 'dinner',
    recipe,
  });
}

/** Remplace un repas de semaine, normalement nourri par le batch. */
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
    expect(days[3].dinner.recipeId).toBe('chili-sin-carne');
    expect(days[3].dinner.kind).toBe('cooked');
    expect(days[3].lunch.recipeId).toBe('batch-curry');
    expect(days[0].dinner.recipeId).toBe('soupe-poireaux');
  });

  it('conserve la version du prompt du plan qu’il modifie', async () => {
    // Remplacer un repas ne recompose pas la semaine : la version qui l'a
    // produite reste la bonne réponse à « qu'est-ce qui a écrit ce plan ».
    await seedPlan();
    const before = (await readPlan()).get('promptVersion');

    await swapMardiDinner();

    expect((await readPlan()).get('promptVersion')).toBe(before);
  });

  it('crée le document de la nouvelle recette', async () => {
    await seedPlan();
    await swapMardiDinner();

    const recipe = await db.doc(paths.recipe(HOUSEHOLD_ID, 'chili-sin-carne')).get();
    expect(recipe.get('name')).toBe('Chili sin carne');
    expect(recipe.get('lastUsedAt')).toBe(WEEK_START);
  });

  it('retire les ingrédients d’un plat frais qu’on remplace', async () => {
    await seedPlan();
    expect(await readItemIds()).toContain('poireau--piece');

    // Le samedi soir est le seul repas cuisiné : le remplacer change la liste.
    await swapSamediDinner();

    const ids = await readItemIds();
    expect(ids).not.toContain('poireau--piece');
    expect(ids).toContain('haricot-rouge--mass');
  });

  it('ne retire pas les ingrédients du batch en remplaçant un repas de semaine', async () => {
    // L'invariant central du modèle : le curry est cuisiné dimanche, donc
    // acheté. Changer le mardi soir ne le décuisine pas.
    await seedPlan();
    await swapMardiDinner();

    const ids = await readItemIds();
    expect(ids).toContain('lentilles-corail--mass');
    expect(ids).toContain('oignon--piece');
  });

  it('garde un ingrédient encore nécessaire à une autre recette', async () => {
    await seedPlan();
    await swapSamediDinner();

    // L'oignon vient aussi du curry, plat du batch : il reste, compté une fois.
    const oignon = await db.doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'oignon--piece')).get();
    expect(oignon.exists).toBe(true);
    expect(oignon.get('qty')).toBe(2);
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
    await swapSamediDinner();

    const recipeIds = (await readPlan()).get('recipeIds');
    expect(recipeIds).toContain('chili-sin-carne');
    expect(recipeIds).toContain('batch-curry');
    expect(recipeIds).not.toContain('soupe-poireaux');
  });

  it('garde le batch dans `recipeIds` et `batchRecipeIds`', async () => {
    await seedPlan();
    await swapSamediDinner();

    const plan = await readPlan();
    expect(plan.get('batchRecipeIds')).toEqual(['batch-curry']);
    expect(plan.get('recipeIds')).toContain('batch-curry');
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
      date: MARDI,
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
