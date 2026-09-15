import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CookingSessionSchema, paths } from '@dimanche-batch/shared';
import { clearFirestore } from '../../__tests__/emulator';
import { ALICE, HOUSEHOLD_ID, MODEL, WEEK_START } from '../../__tests__/fixtures';
import { db } from '../firestore';
import { readCookingSession, writeCookingSession } from '../cooking-session-writer';

/**
 * La session de cuisson est lue par les deux téléphones : ce qui s'écrit doit
 * être exactement ce que le schéma décrit, ni plus ni moins.
 */
const session = {
  cuts: [
    { recipeId: 'curry', ingredient: 'oignon', cut: 'émincé' },
    { recipeId: 'chili', ingredient: 'poivron', cut: 'en dés' },
  ],
  steps: [
    { recipeId: 'curry', text: 'Faire revenir l’oignon avec les épices.' },
    { recipeId: 'chili', text: 'Faire sauter le poivron.' },
  ],
  timings: [
    { recipeId: 'curry', cookMinutes: 25 },
    { recipeId: 'chili', cookMinutes: 0 },
  ],
};

async function write() {
  await writeCookingSession({
    householdId: HOUSEHOLD_ID,
    weekId: WEEK_START,
    sourceRecipeIds: ['curry', 'chili'],
    session,
    generatedBy: ALICE,
    model: MODEL,
  });
}

beforeEach(clearFirestore);
afterAll(clearFirestore);

describe('writeCookingSession', () => {
  it('écrit une session qui se relit à l’identique', async () => {
    await write();

    const read = await readCookingSession(HOUSEHOLD_ID, WEEK_START);
    expect(read?.steps).toEqual(session.steps);
    expect(read?.cuts).toEqual(session.cuts);
    expect(read?.timings).toEqual(session.timings);
    expect(read?.sourceRecipeIds).toEqual(['curry', 'chili']);
  });

  it('n’écrit que les champs que le schéma décrit', async () => {
    await write();

    const snapshot = await db.doc(paths.batchSession(HOUSEHOLD_ID, WEEK_START)).get();
    const expected = Object.keys(CookingSessionSchema.shape).filter((key) => key !== 'id');
    expect(Object.keys(snapshot.data() ?? {}).sort()).toEqual(expected.sort());
  });
});

describe('readCookingSession', () => {
  it('rend null quand la semaine n’a pas encore de session', async () => {
    await expect(readCookingSession(HOUSEHOLD_ID, WEEK_START)).resolves.toBeNull();
  });

  // Un document illisible ne doit pas passer pour une session à jour : la
  // callable ne la recomposerait sinon jamais.
  it('rend null sur un document illisible', async () => {
    await db.doc(paths.batchSession(HOUSEHOLD_ID, WEEK_START)).set({ steps: 'cassé' });
    await expect(readCookingSession(HOUSEHOLD_ID, WEEK_START)).resolves.toBeNull();
  });
});
