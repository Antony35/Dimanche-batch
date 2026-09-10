import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ALICE, BOB, HOUSEHOLD_ID, MALLORY, WEEK_ID, createTestEnvironment, seed } from './setup';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createTestEnvironment();
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed(testEnv);
});

const memberDb = () => testEnv.authenticatedContext(ALICE).firestore();
const outsiderDb = () => testEnv.authenticatedContext(MALLORY).firestore();
const anonDb = () => testEnv.unauthenticatedContext().firestore();

describe('households', () => {
  it('laisse un membre lire son foyer', async () => {
    await assertSucceeds(getDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}`)));
  });

  it('refuse la lecture à qui n’est pas membre', async () => {
    await assertFails(getDoc(doc(outsiderDb(), `households/${HOUSEHOLD_ID}`)));
    await assertFails(getDoc(doc(anonDb(), `households/${HOUSEHOLD_ID}`)));
  });

  it('autorise la création d’un foyer dont on est le seul membre', async () => {
    await assertSucceeds(
      setDoc(doc(memberDb(), 'households/nouveau'), {
        name: 'Chez nous',
        members: [ALICE],
        inviteCode: 'BATCH-ABCD',
        createdAt: Date.now(),
        createdBy: ALICE,
      }),
    );
  });

  it('refuse de créer un foyer en s’y ajoutant avec quelqu’un d’autre', async () => {
    await assertFails(
      setDoc(doc(memberDb(), 'households/pirate'), {
        name: 'Chez eux',
        members: [ALICE, BOB],
        inviteCode: 'BATCH-ABCD',
        createdAt: Date.now(),
        createdBy: ALICE,
      }),
    );
  });

  it('rend `members` immuable depuis le client', async () => {
    // Le seul chemin d'ajout est la callable joinHousehold, côté serveur.
    await assertFails(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}`), {
        members: [ALICE, BOB, MALLORY],
      }),
    );
  });

  it('laisse un membre renommer le foyer et régénérer le code', async () => {
    await assertSucceeds(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}`), {
        name: 'Maison bis',
        inviteCode: 'BATCH-9K3M',
      }),
    );
  });
});

describe('weeklyPlans', () => {
  it('est lisible par un membre', async () => {
    await assertSucceeds(
      getDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/weeklyPlans/${WEEK_ID}`)),
    );
  });

  it('n’est jamais écrit par le client', async () => {
    // Les plans viennent exclusivement de generateWeeklyPlan (admin SDK).
    await assertFails(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/weeklyPlans/${WEEK_ID}`), {
        model: 'bidon',
      }),
    );
  });
});

describe('recipes', () => {
  it('autorise le seul passage en favori', async () => {
    await assertSucceeds(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/recipes/recipe-1`), {
        isFavorite: true,
      }),
    );
  });

  it('autorise le bannissement, qui lève le favori dans la même écriture', async () => {
    await assertSucceeds(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/recipes/recipe-1`), {
        isFavorite: false,
        isDisliked: true,
      }),
    );
  });

  it('refuse la modification du contenu d’une recette', async () => {
    await assertFails(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/recipes/recipe-1`), {
        name: 'Recette réécrite',
      }),
    );
    await assertFails(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/recipes/recipe-1`), {
        isFavorite: true,
        prepMinutes: 5,
      }),
    );
    // Un verdict ne sert pas de cheval de Troie pour le reste du document.
    await assertFails(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/recipes/recipe-1`), {
        isDisliked: true,
        name: 'Recette réécrite',
      }),
    );
  });
});

describe('liste de courses', () => {
  const itemPath = `households/${HOUSEHOLD_ID}/groceryLists/${WEEK_ID}/items/lentilles--mass`;

  it('autorise à cocher un article', async () => {
    await assertSucceeds(updateDoc(doc(memberDb(), itemPath), { checked: true }));
  });

  it('refuse de modifier la quantité en cochant', async () => {
    await assertFails(updateDoc(doc(memberDb(), itemPath), { checked: true, qty: 1 }));
  });

  it('refuse tout accès à qui n’est pas membre', async () => {
    await assertFails(getDoc(doc(outsiderDb(), itemPath)));
    await assertFails(updateDoc(doc(outsiderDb(), itemPath), { checked: true }));
  });
});

describe('verrou de génération', () => {
  it('est lisible mais jamais posé ni levé par le client', async () => {
    // Pouvoir le lire sert à afficher « génération en cours » ; pouvoir
    // l'écrire permettrait de bloquer l'autre téléphone indéfiniment.
    const alice = testEnv.authenticatedContext(ALICE).firestore();
    const lock = doc(alice, `households/${HOUSEHOLD_ID}/locks/${WEEK_ID}`);

    await assertSucceeds(getDoc(lock));
    await assertFails(setDoc(lock, { startedAt: Date.now(), by: ALICE }));
    await assertFails(deleteDoc(lock));
  });
});

describe('quota', () => {
  it('est lisible mais jamais modifiable par le client', async () => {
    await assertSucceeds(getDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/usage/2026-09-13`)));
    await assertFails(
      updateDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/usage/2026-09-13`), {
        generations: 0,
      }),
    );
  });
});
