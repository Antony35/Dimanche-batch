import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { paths, type Recipe } from '@dimanche-batch/shared';
import { clearFirestore } from '../../__tests__/emulator';
import { HOUSEHOLD_ID, WEEK_START } from '../../__tests__/fixtures';
import { db } from '../firestore';
import {
  readBannedRecipeNames,
  readFavoriteRecipeNames,
  readHouseholdMemory,
} from '../recipe-memory';

/**
 * La mémoire du foyer envoie au modèle trois listes de sens différents. Ce qui
 * se teste ici n'est pas leur contenu — trivial — mais qu'elles ne se
 * contredisent jamais : demander un plat et l'interdire dans le même prompt
 * produirait un résultat que personne ne saurait expliquer.
 */

async function seedRecipe(
  id: string,
  overrides: Partial<Pick<Recipe, 'name' | 'isFavorite' | 'isDisliked'>>,
): Promise<void> {
  await db.doc(paths.recipe(HOUSEHOLD_ID, id)).set({
    name: id,
    servings: 4,
    prepMinutes: 30,
    tags: ['one-pot'],
    ingredients: [{ name: 'lentilles corail', qty: 250, unit: 'g', aisle: 'epicerie' }],
    steps: ['Cuire.'],
    lastUsedAt: null,
    isFavorite: false,
    isDisliked: false,
    createdAt: Date.now(),
    ...overrides,
  });
}

beforeEach(clearFirestore);
afterAll(clearFirestore);

describe('readBannedRecipeNames', () => {
  it('ne rend que les plats bannis', async () => {
    await seedRecipe('curry', { name: 'Curry de lentilles' });
    await seedRecipe('gratin', { name: 'Gratin de courgettes', isDisliked: true });

    expect(await readBannedRecipeNames(HOUSEHOLD_ID)).toEqual(['Gratin de courgettes']);
  });

  it('rend une liste vide quand le foyer n’a rien banni', async () => {
    await seedRecipe('curry', { name: 'Curry de lentilles' });

    expect(await readBannedRecipeNames(HOUSEHOLD_ID)).toEqual([]);
  });
});

describe('readFavoriteRecipeNames', () => {
  it('écarte un favori servi récemment', async () => {
    await seedRecipe('chili', { name: 'Chili sin carne', isFavorite: true });

    expect(await readFavoriteRecipeNames(HOUSEHOLD_ID, ['Chili sin carne'])).toEqual([]);
  });

  // Les Security Rules ne peuvent pas interdire cet état à elles seules : la
  // règle borne les champs écrits, pas leur cohérence. Le rejet l'emporte.
  it('écarte un plat à la fois favori et banni', async () => {
    await seedRecipe('gratin', {
      name: 'Gratin de courgettes',
      isFavorite: true,
      isDisliked: true,
    });

    expect(await readFavoriteRecipeNames(HOUSEHOLD_ID, [], ['Gratin de courgettes'])).toEqual([]);
  });

  it('compare les noms sans tenir compte de la casse ni des accents', async () => {
    await seedRecipe('creme', { name: 'Crème brûlée', isFavorite: true });

    expect(await readFavoriteRecipeNames(HOUSEHOLD_ID, [], ['CREME BRULEE'])).toEqual([]);
  });
});

describe('readHouseholdMemory', () => {
  it('compose les trois listes sans qu’aucune n’en contredise une autre', async () => {
    await seedRecipe('chili', { name: 'Chili sin carne', isFavorite: true });
    await seedRecipe('gratin', {
      name: 'Gratin de courgettes',
      isFavorite: true,
      isDisliked: true,
    });

    const memory = await readHouseholdMemory(HOUSEHOLD_ID, WEEK_START);

    expect(memory.bannedRecipeNames).toEqual(['Gratin de courgettes']);
    expect(memory.favoriteRecipeNames).toEqual(['Chili sin carne']);
    expect(memory.recentRecipeNames).toEqual([]);
  });
});
