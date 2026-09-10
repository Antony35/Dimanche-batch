import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { paths, type GeneratedPlan, type GeneratedRecipe } from '@dimanche-batch/shared';
import { clearFirestore } from '../../__tests__/emulator';
import {
  ALICE,
  HOUSEHOLD_ID,
  MODEL,
  WEEK_START,
  makeGeneratedPlan,
  makeGeneratedRecipe,
} from '../../__tests__/fixtures';
import { PROMPT_VERSION } from '../../gemini/prompt';
import { db } from '../firestore';
import { writeWeeklyPlan } from '../plan-writer';

/**
 * `writeWeeklyPlan` est le seul endroit du projet qui écrit six documents d'un
 * coup en écrasant l'état précédent. Ce que ces tests protègent, ce n'est pas
 * la forme des documents — Zod s'en charge — mais ce que l'écrasement doit
 * épargner : un favori, une date de découverte, une case cochée au magasin.
 */

async function write(plan: GeneratedPlan) {
  return writeWeeklyPlan({
    householdId: HOUSEHOLD_ID,
    weekStart: WEEK_START,
    generatedBy: ALICE,
    plan,
    model: MODEL,
  });
}

async function readItems(): Promise<Record<string, FirebaseFirestore.DocumentData>> {
  const snapshot = await db.collection(paths.groceryItems(HOUSEHOLD_ID, WEEK_START)).get();
  return Object.fromEntries(snapshot.docs.map((doc) => [doc.id, doc.data()]));
}

const curry = makeGeneratedRecipe({
  slug: 'batch-curry',
  name: 'Curry de lentilles',
  ingredients: [{ name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' }],
});

const soupe = makeGeneratedRecipe({
  slug: 'soupe-poireaux',
  name: 'Soupe de poireaux',
  ingredients: [{ name: 'poireaux', qty: 3, unit: 'piece', aisle: 'fruits-legumes' }],
});

beforeEach(async () => {
  await clearFirestore();
});

afterAll(async () => {
  await clearFirestore();
});

describe('écriture initiale', () => {
  it('écrit le plan, les recettes, la liste et ses articles', async () => {
    const result = await write(makeGeneratedPlan([curry, soupe]));

    expect(result).toEqual({ weekId: WEEK_START, recipeCount: 2, itemCount: 2 });

    const plan = await db.doc(paths.weeklyPlan(HOUSEHOLD_ID, WEEK_START)).get();
    expect(plan.exists).toBe(true);
    expect(plan.get('weekStart')).toBe(WEEK_START);
    expect(plan.get('generatedBy')).toBe(ALICE);
    expect(plan.get('model')).toBe(MODEL);
    expect(plan.get('days')).toHaveLength(7);

    // La version du prompt est stockée avec le modèle et pour la même raison :
    // savoir quelle formulation a composé une semaine qui revient bancale.
    expect(plan.get('promptVersion')).toBe(PROMPT_VERSION);

    const recipe = await db.doc(paths.recipe(HOUSEHOLD_ID, 'batch-curry')).get();
    expect(recipe.get('name')).toBe('Curry de lentilles');
    expect(recipe.get('lastUsedAt')).toBe(WEEK_START);

    const list = await db.doc(paths.groceryList(HOUSEHOLD_ID, WEEK_START)).get();
    expect(list.get('itemCount')).toBe(2);
    expect(Object.keys(await readItems())).toHaveLength(2);
  });

  it('donne au document recette l’identifiant du slug', async () => {
    await write(makeGeneratedPlan([curry, soupe]));

    const snapshot = await db.collection(paths.recipes(HOUSEHOLD_ID)).get();
    expect(snapshot.docs.map((doc) => doc.id).sort()).toEqual(['batch-curry', 'soupe-poireaux']);
  });

  it('ne référence dans `recipeIds` que les recettes réellement au menu', async () => {
    // Une recette proposée par le modèle mais qu'aucun repas ne sert.
    const base = makeGeneratedPlan([curry, soupe]);
    await write({
      ...base,
      recipes: [...base.recipes, makeGeneratedRecipe({ slug: 'jamais-servie' })],
    });

    const plan = await db.doc(paths.weeklyPlan(HOUSEHOLD_ID, WEEK_START)).get();
    // La recette existe comme document — elle reste consultable — mais le plan
    // de la semaine ne la cite pas.
    expect(plan.get('recipeIds')).toEqual(['batch-curry', 'soupe-poireaux']);
    expect((await db.doc(paths.recipe(HOUSEHOLD_ID, 'jamais-servie')).get()).exists).toBe(true);
  });

  it('n’achète pas les ingrédients d’un midi de restes', async () => {
    // Un seul soir cuisiné : la quantité doit valoir exactement une recette,
    // pas une par repas où la recette apparaît.
    const plan: GeneratedPlan = {
      recipes: [curry],
      batchRecipeSlugs: ['batch-curry'],
      days: [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => ({
        dayIndex,
        lunch: {
          recipeSlug: 'batch-curry',
          kind: 'batch-leftover' as const,
          withStarter: false,
          withDessert: false,
        },
        dinner: {
          recipeSlug: dayIndex === 0 ? 'batch-curry' : null,
          kind: dayIndex === 0 ? ('cooked' as const) : ('eat-out' as const),
          withStarter: false,
          withDessert: false,
        },
      })),
    };

    await write(plan);

    const items = Object.values(await readItems());
    expect(items).toHaveLength(1);
    expect(items[0]?.qty).toBe(250);
  });
});

describe('régénération sur une semaine déjà écrite', () => {
  it('préserve `isFavorite`, `isDisliked` et `createdAt` d’une recette connue', async () => {
    await write(makeGeneratedPlan([curry, soupe]));

    const ref = db.doc(paths.recipe(HOUSEHOLD_ID, 'batch-curry'));
    await ref.update({ isFavorite: true, isDisliked: true });
    const createdAt = (await ref.get()).get('createdAt');

    // Le modèle repropose la même recette, avec un contenu retouché.
    const retouche = makeGeneratedRecipe({ slug: 'batch-curry', name: 'Curry de lentilles corail' });
    await write(makeGeneratedPlan([retouche, soupe]));

    const after = await ref.get();
    expect(after.get('name')).toBe('Curry de lentilles corail');
    expect(after.get('isFavorite')).toBe(true);
    // Un plat banni le reste : c'est le foyer qui l'a écrit, pas le modèle.
    expect(after.get('isDisliked')).toBe(true);
    expect(after.get('createdAt')).toBe(createdAt);
  });

  it('garde cochés les articles déjà achetés', async () => {
    await write(makeGeneratedPlan([curry, soupe]));
    const [lentillesId] = Object.keys(await readItems()).filter((id) => id.startsWith('lentilles'));
    expect(lentillesId).toBeDefined();

    await db.doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, lentillesId!)).update({
      checked: true,
    });

    await write(makeGeneratedPlan([curry, soupe]));

    const items = await readItems();
    expect(items[lentillesId!]?.checked).toBe(true);
  });

  it('laisse décoché un article qui apparaît pour la première fois', async () => {
    await write(makeGeneratedPlan([curry]));

    await write(makeGeneratedPlan([curry, soupe]));

    const items = await readItems();
    const nouveaux = Object.entries(items).filter(([id]) => id.startsWith('poireaux'));
    expect(nouveaux).toHaveLength(1);
    expect(nouveaux[0]?.[1].checked).toBe(false);
  });

  it('supprime les articles d’un repas qui n’est plus au menu', async () => {
    await write(makeGeneratedPlan([curry, soupe]));
    expect(Object.keys(await readItems())).toHaveLength(2);

    const result = await write(makeGeneratedPlan([curry]));

    const items = await readItems();
    expect(Object.keys(items)).toHaveLength(1);
    expect(Object.keys(items).some((id) => id.startsWith('poireaux'))).toBe(false);
    expect(result.itemCount).toBe(1);
  });

  it('supprime aussi un article devenu illisible', async () => {
    await write(makeGeneratedPlan([curry]));

    // Un document que le schéma refuse : il ne peut plus transmettre son
    // `checked`, mais il doit malgré tout disparaître de la liste.
    await db
      .doc(paths.groceryItem(HOUSEHOLD_ID, WEEK_START, 'vestige-corrompu'))
      .set({ name: 'reste d’une version précédente' });

    await write(makeGeneratedPlan([curry]));

    expect(Object.keys(await readItems())).not.toContain('vestige-corrompu');
  });
});
