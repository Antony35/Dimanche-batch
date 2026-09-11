import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BatchScheduleSchema, paths } from '@dimanche-batch/shared';
import { clearFirestore } from '../../__tests__/emulator';
import { ALICE, HOUSEHOLD_ID, MODEL, WEEK_START } from '../../__tests__/fixtures';
import { db } from '../firestore';
import { readBatchSchedule, writeBatchSchedule } from '../batch-schedule-writer';

/**
 * Le déroulé est lu par les deux téléphones : ce qui s'écrit doit être
 * exactement ce que le schéma décrit, ni plus ni moins.
 */
const schedule = {
  steps: [
    { recipeIds: ['curry', 'chili'], text: 'Émincer les oignons des deux plats.' },
    { recipeIds: ['chili'], text: 'Lancer le chili à feu doux.' },
    { recipeIds: ['curry'], text: 'Pendant ce temps, préparer le curry.' },
  ],
};

beforeEach(clearFirestore);
afterAll(clearFirestore);

describe('writeBatchSchedule', () => {
  it('écrit un déroulé qui se relit à l’identique', async () => {
    await writeBatchSchedule({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_START,
      sourceRecipeIds: ['curry', 'chili'],
      schedule,
      generatedBy: ALICE,
      model: MODEL,
    });

    const read = await readBatchSchedule(HOUSEHOLD_ID, WEEK_START);
    expect(read?.steps).toEqual(schedule.steps);
    expect(read?.sourceRecipeIds).toEqual(['curry', 'chili']);
  });

  it('n’écrit que les champs que le schéma décrit', async () => {
    await writeBatchSchedule({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_START,
      sourceRecipeIds: ['curry', 'chili'],
      schedule,
      generatedBy: ALICE,
      model: MODEL,
    });

    const snapshot = await db.doc(paths.batchSchedule(HOUSEHOLD_ID, WEEK_START)).get();
    const expected = Object.keys(BatchScheduleSchema.shape).filter((key) => key !== 'id');
    expect(Object.keys(snapshot.data() ?? {}).sort()).toEqual(expected.sort());
  });
});

describe('readBatchSchedule', () => {
  it('rend null quand la semaine n’a pas encore de déroulé', async () => {
    await expect(readBatchSchedule(HOUSEHOLD_ID, WEEK_START)).resolves.toBeNull();
  });

  // Un document illisible ne doit pas passer pour un déroulé à jour : la
  // callable le recomposerait sinon jamais.
  it('rend null sur un document illisible', async () => {
    await db.doc(paths.batchSchedule(HOUSEHOLD_ID, WEEK_START)).set({ steps: 'cassé' });
    await expect(readBatchSchedule(HOUSEHOLD_ID, WEEK_START)).resolves.toBeNull();
  });
});
