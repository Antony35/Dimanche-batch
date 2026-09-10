import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

export const HOUSEHOLD_ID = 'household-test';
export const WEEK_ID = '2026-09-14';
export const ALICE = 'uid-alice';
export const BOB = 'uid-bob';
export const MALLORY = 'uid-mallory';

/**
 * Environnement de test contre l'émulateur Firestore.
 *
 * Ces tests valident le seul rempart qui protège les données quand quelqu'un
 * parle à Firestore autrement que par l'app — avec un token volé, ou avec du
 * code modifié. Une règle non testée est une règle dont on suppose l'effet.
 */
export async function createTestEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'dimanche-batch-rules-test',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] ?? '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] ?? 8080),
    },
  });
}

/** Données de départ, écrites en contournant les règles. */
export async function seed(testEnv: RulesTestEnvironment): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.doc(`households/${HOUSEHOLD_ID}`).set({
      name: 'Maison',
      members: [ALICE, BOB],
      inviteCode: 'BATCH-7F2K',
      createdAt: Date.now(),
      createdBy: ALICE,
    });

    await db.doc(`households/${HOUSEHOLD_ID}/weeklyPlans/${WEEK_ID}`).set({
      weekStart: WEEK_ID,
      days: [],
      recipeIds: ['recipe-1'],
      generatedAt: Date.now(),
      generatedBy: ALICE,
      model: 'gemini-2.5-flash',
    });

    await db.doc(`households/${HOUSEHOLD_ID}/recipes/recipe-1`).set({
      name: 'Curry de lentilles',
      servings: 2,
      prepMinutes: 25,
      tags: ['one-pot'],
      ingredients: [],
      steps: ['Cuire.'],
      lastUsedAt: null,
      isFavorite: false,
      isDisliked: false,
      createdAt: Date.now(),
    });

    await db.doc(`households/${HOUSEHOLD_ID}/groceryLists/${WEEK_ID}`).set({
      itemCount: 1,
      generatedAt: Date.now(),
    });

    await db.doc(`households/${HOUSEHOLD_ID}/groceryLists/${WEEK_ID}/items/lentilles--mass`).set({
      name: 'lentilles corail',
      qty: 250,
      unit: 'g',
      aisle: 'epicerie',
      checked: false,
      fromRecipeIds: ['recipe-1'],
    });

    await db.doc(`households/${HOUSEHOLD_ID}/usage/2026-09-13`).set({ generations: 1 });
  });
}
