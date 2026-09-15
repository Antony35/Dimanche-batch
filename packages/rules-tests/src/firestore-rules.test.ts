import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  const items = `households/${HOUSEHOLD_ID}/groceryLists/${WEEK_ID}/items`;
  const itemPath = `${items}/lentilles--mass`;
  const manualPath = `${items}/manual--sac-poubelle--piece`;

  /** Article manuel valide — base des variantes refusées ci-dessous. */
  const manualItem = {
    name: 'produit vaisselle',
    qty: 1,
    unit: 'piece',
    aisle: 'entretien',
    checked: false,
    origin: 'manual',
    fromRecipeIds: [],
  };

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

  /**
   * La sixième écriture cliente du dépôt. Ce qui la rend sûre n'est pas la
   * bonne foi de l'app mais l'espace de noms : le client ne peut écrire que
   * sous `manual--`, et ne peut y écrire que des articles `manual`.
   */
  it('autorise l’ajout d’un article à la main', async () => {
    await assertSucceeds(
      setDoc(doc(memberDb(), `${items}/manual--produit-vaisselle--piece`), manualItem),
    );
  });

  it('refuse de créer un article hors de l’espace de noms manuel', async () => {
    await assertFails(setDoc(doc(memberDb(), `${items}/produit-vaisselle--piece`), manualItem));
  });

  it('refuse de créer un faux article du batch', async () => {
    // C'est l'attaque que la règle doit arrêter : fabriquer un article que le
    // recalcul croira légitime, ou que le client pourra ensuite supprimer.
    await assertFails(
      setDoc(doc(memberDb(), `${items}/manual--faux--piece`), {
        ...manualItem,
        origin: 'batch',
      }),
    );
  });

  it('refuse un article mal formé', async () => {
    const cases = [
      { ...manualItem, aisle: 'cave-a-vin' },
      { ...manualItem, unit: 'tonne' },
      { ...manualItem, qty: 0 },
      { ...manualItem, qty: -3 },
      { ...manualItem, name: '' },
      { ...manualItem, fromRecipeIds: ['recipe-1'] },
      { ...manualItem, surprise: 'champ en trop' },
    ];

    for (const [index, payload] of cases.entries()) {
      await assertFails(setDoc(doc(memberDb(), `${items}/manual--cas-${index}--piece`), payload));
    }
  });

  it('refuse un article incomplet', async () => {
    const { qty: _qty, ...withoutQty } = manualItem;
    await assertFails(setDoc(doc(memberDb(), `${items}/manual--incomplet--piece`), withoutQty));
  });

  it('autorise la suppression d’un article ajouté à la main', async () => {
    await assertSucceeds(deleteDoc(doc(memberDb(), manualPath)));
  });

  it('refuse la suppression d’un article calculé', async () => {
    // Supprimer une ligne du batch ferait sous-acheter sans un mot ; le
    // recalcul, lui, la ferait revenir sans expliquer pourquoi.
    await assertFails(deleteDoc(doc(memberDb(), itemPath)));
  });

  it('refuse ajout et suppression à qui n’est pas membre', async () => {
    await assertFails(setDoc(doc(outsiderDb(), `${items}/manual--intrus--piece`), manualItem));
    await assertFails(deleteDoc(doc(outsiderDb(), manualPath)));
  });
});

/**
 * Septième et huitième écritures clientes : le lexique des rayons du foyer.
 * L'app l'écrit en fusion (`merge`) pour que deux téléphones qui corrigent en
 * même temps ne s'écrasent pas.
 */
describe('lexique des rayons', () => {
  const lexiconPath = `households/${HOUSEHOLD_ID}/lexicon/overrides`;

  it('autorise un membre à enregistrer une correction de rayon', async () => {
    await assertSucceeds(
      setDoc(doc(memberDb(), lexiconPath), { entries: { 'sac poubelle': 'entretien' } }),
    );
    await assertSucceeds(getDoc(doc(memberDb(), lexiconPath)));
  });

  it('fusionne une seconde correction sans effacer la première', async () => {
    await setDoc(doc(memberDb(), lexiconPath), { entries: { 'sac poubelle': 'entretien' } });
    await assertSucceeds(
      setDoc(doc(memberDb(), lexiconPath), { entries: { kombucha: 'boissons' } }, { merge: true }),
    );

    const snapshot = await getDoc(doc(memberDb(), lexiconPath));
    expect(snapshot.get('entries')).toEqual({ 'sac poubelle': 'entretien', kombucha: 'boissons' });
  });

  it('refuse un rayon inventé', async () => {
    await assertFails(
      setDoc(doc(memberDb(), lexiconPath), { entries: { 'sac poubelle': 'cave-a-vin' } }),
    );
  });

  it('refuse un champ en trop, un autre document et la suppression', async () => {
    await assertFails(setDoc(doc(memberDb(), lexiconPath), { entries: {}, surprise: true }));
    await assertFails(
      setDoc(doc(memberDb(), `households/${HOUSEHOLD_ID}/lexicon/autre`), { entries: {} }),
    );
    await setDoc(doc(memberDb(), lexiconPath), { entries: {} });
    await assertFails(deleteDoc(doc(memberDb(), lexiconPath)));
  });

  it('refuse tout accès à qui n’est pas membre', async () => {
    await assertFails(getDoc(doc(outsiderDb(), lexiconPath)));
    await assertFails(setDoc(doc(outsiderDb(), lexiconPath), { entries: { eau: 'boissons' } }));
  });
});

/**
 * Les Security Rules n'importent rien : les listes d'unités et de rayons y sont
 * recopiées à la main. C'est la seule duplication du dépôt, et elle se
 * détecterait autrement le jour où un rayon ajouté au schéma serait refusé par
 * la règle — sans message, et seulement sur le téléphone.
 */
describe('duplication des énumérations dans les règles', () => {
  const rules = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');
  const shared = readFileSync(resolve(__dirname, '../../shared/src/schemas/common.ts'), 'utf8');

  function valuesOf(source: string, marker: string): string[] {
    const start = source.indexOf(marker);
    const opening = source.indexOf('[', start);
    const closing = source.indexOf(']', opening);
    return [...source.slice(opening, closing).matchAll(/'([^']+)'/g)].map(
      (match) => match[1] ?? '',
    );
  }

  it('recopie exactement les rayons du schéma', () => {
    expect(valuesOf(rules, 'function aisleValues()')).toEqual(valuesOf(shared, 'const AISLES'));
  });

  it('recopie exactement les unités du schéma', () => {
    expect(valuesOf(rules, 'function unitValues()')).toEqual(valuesOf(shared, 'const UNITS'));
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

describe('batchSessions', () => {
  const schedulePath = `households/${HOUSEHOLD_ID}/batchSessions/${WEEK_ID}`;

  it('laisse un membre lire la session de cuisson', async () => {
    await assertSucceeds(getDoc(doc(memberDb(), schedulePath)));
  });

  it('refuse la lecture à qui n’est pas du foyer', async () => {
    await assertFails(getDoc(doc(outsiderDb(), schedulePath)));
    await assertFails(getDoc(doc(anonDb(), schedulePath)));
  });

  // Composé par Gemini dans une callable : le client n'a aucune raison d'en
  // fabriquer un, et pouvoir le faire lui laisserait réécrire la session du
  // dimanche de l'autre téléphone.
  it('refuse toute écriture au client, membre compris', async () => {
    await assertFails(setDoc(doc(memberDb(), schedulePath), { steps: [] }));
  });
});
