import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DAILY_GENERATION_LIMIT, paths, toIsoDate } from '@dimanche-batch/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { clearFirestore } from '../../__tests__/emulator';
import { ALICE, BOB, HOUSEHOLD_ID, MALLORY } from '../../__tests__/fixtures';
import { db } from '../firestore';
import { consumeGenerationQuota, requireAuth, requireHouseholdMember } from '../guards';

/**
 * Ces guards sont le seul contrôle d'accès des callables : l'admin SDK n'est
 * pas soumis aux Security Rules. Ce qu'ils laissent passer, rien ne le rattrape.
 */

const TODAY = toIsoDate(new Date());

async function expectHttpsError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(HttpsError);
  await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(async () => {
  await clearFirestore();
  await db.doc(paths.household(HOUSEHOLD_ID)).set({
    name: 'Maison',
    members: [ALICE, BOB],
    inviteCode: 'BATCH-7F2K',
    createdAt: Date.now(),
    createdBy: ALICE,
  });
});

afterAll(async () => {
  await clearFirestore();
});

describe('requireAuth', () => {
  it('rend l’uid d’un appelant authentifié', () => {
    expect(requireAuth({ auth: { uid: ALICE } })).toBe(ALICE);
  });

  it('refuse un appel anonyme', () => {
    expect(() => requireAuth({})).toThrow(HttpsError);
    expect(() => requireAuth({})).toThrow(
      expect.objectContaining({ code: 'permission-denied' }),
    );
  });
});

describe('requireHouseholdMember', () => {
  it('laisse passer un membre', async () => {
    await expect(requireHouseholdMember(BOB, HOUSEHOLD_ID)).resolves.toBeUndefined();
  });

  it('refuse quelqu’un qui n’est pas membre', async () => {
    await expectHttpsError(
      requireHouseholdMember(MALLORY, HOUSEHOLD_ID),
      'permission-denied',
    );
  });

  it('refuse un foyer inexistant', async () => {
    await expectHttpsError(requireHouseholdMember(ALICE, 'foyer-fantome'), 'permission-denied');
  });

  it('refuse si `members` n’est pas un tableau', async () => {
    await db.doc(paths.household(HOUSEHOLD_ID)).update({ members: ALICE });
    await expectHttpsError(requireHouseholdMember(ALICE, HOUSEHOLD_ID), 'permission-denied');
  });
});

describe('consumeGenerationQuota', () => {
  it('crée le compteur du jour à la première génération', async () => {
    await expect(consumeGenerationQuota(HOUSEHOLD_ID)).resolves.toBe(1);

    const usage = await db.doc(paths.usageDay(HOUSEHOLD_ID, TODAY)).get();
    expect(usage.get('generations')).toBe(1);
  });

  it('incrémente à chaque appel', async () => {
    await consumeGenerationQuota(HOUSEHOLD_ID);
    await consumeGenerationQuota(HOUSEHOLD_ID);
    await expect(consumeGenerationQuota(HOUSEHOLD_ID)).resolves.toBe(3);
  });

  it('refuse au-delà du plafond quotidien', async () => {
    await db
      .doc(paths.usageDay(HOUSEHOLD_ID, TODAY))
      .set({ generations: DAILY_GENERATION_LIMIT });

    await expectHttpsError(consumeGenerationQuota(HOUSEHOLD_ID), 'resource-exhausted');

    // Un refus ne doit pas non plus incrémenter le compteur.
    const usage = await db.doc(paths.usageDay(HOUSEHOLD_ID, TODAY)).get();
    expect(usage.get('generations')).toBe(DAILY_GENERATION_LIMIT);
  });

  it('traite un compteur corrompu comme zéro plutôt que comme un passe-droit', async () => {
    await db.doc(paths.usageDay(HOUSEHOLD_ID, TODAY)).set({ generations: 'beaucoup' });

    await expect(consumeGenerationQuota(HOUSEHOLD_ID)).resolves.toBe(1);
  });

  it('tient le plafond quand les deux téléphones génèrent en même temps', async () => {
    // La raison d'être de la transaction : sans elle, des lectures simultanées
    // liraient toutes la même valeur et le plafond sauterait.
    const attempts = DAILY_GENERATION_LIMIT + 4;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => consumeGenerationQuota(HOUSEHOLD_ID)),
    );

    const accepted = results.filter((result) => result.status === 'fulfilled').length;
    const usage = await db.doc(paths.usageDay(HOUSEHOLD_ID, TODAY)).get();

    // La propriété qui compte n'est pas « exactement dix » — sous contention,
    // une transaction peut légitimement abandonner — mais qu'aucun appel
    // accepté ne soit perdu, et qu'aucun refusé n'ait consommé du quota.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThanOrEqual(DAILY_GENERATION_LIMIT);
    expect(usage.get('generations')).toBe(accepted);
  });
});
