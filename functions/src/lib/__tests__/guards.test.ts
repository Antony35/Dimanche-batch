import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DAILY_GENERATION_LIMIT,
  GENERATION_LOCK_TTL_MS,
  GenerationLockSchema,
  paths,
  toIsoDate,
} from '@dimanche-batch/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { clearFirestore } from '../../__tests__/emulator';
import { ALICE, BOB, HOUSEHOLD_ID, MALLORY } from '../../__tests__/fixtures';
import { db } from '../firestore';
import {
  acquireGenerationLock,
  consumeGenerationQuota,
  refundGenerationQuota,
  releaseGenerationLock,
  reportGenerationStep,
  requireAuth,
  requireHouseholdMember,
} from '../guards';

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

describe('refundGenerationQuota', () => {
  it('rend la génération décomptée pour rien', async () => {
    await consumeGenerationQuota(HOUSEHOLD_ID);
    await consumeGenerationQuota(HOUSEHOLD_ID);

    await refundGenerationQuota(HOUSEHOLD_ID);

    const usage = await db.doc(paths.usageDay(HOUSEHOLD_ID, TODAY)).get();
    expect(usage.get('generations')).toBe(1);
  });

  it('rouvre le quota juste sous le plafond', async () => {
    await db
      .doc(paths.usageDay(HOUSEHOLD_ID, TODAY))
      .set({ generations: DAILY_GENERATION_LIMIT });
    await expectHttpsError(consumeGenerationQuota(HOUSEHOLD_ID), 'resource-exhausted');

    await refundGenerationQuota(HOUSEHOLD_ID);

    // Une seule génération redevient possible, pas davantage.
    await expect(consumeGenerationQuota(HOUSEHOLD_ID)).resolves.toBe(DAILY_GENERATION_LIMIT);
    await expectHttpsError(consumeGenerationQuota(HOUSEHOLD_ID), 'resource-exhausted');
  });

  it('ne descend jamais sous zéro', async () => {
    await refundGenerationQuota(HOUSEHOLD_ID);
    await refundGenerationQuota(HOUSEHOLD_ID);

    const usage = await db.doc(paths.usageDay(HOUSEHOLD_ID, TODAY)).get();
    expect(usage.exists ? usage.get('generations') : 0).toBe(0);
  });

  it('ne remonte jamais d’erreur à l’appelant', async () => {
    // L'appelant reçoit déjà l'erreur qui l'intéresse ; une seconde par-dessus
    // ne l'aiderait pas. Un foyer inexistant ne doit donc rien lever.
    await expect(refundGenerationQuota('foyer-fantome')).resolves.toBeUndefined();
  });
});

describe('acquireGenerationLock', () => {
  const WEEK = '2026-09-14';

  it('pose le verrou de la semaine', async () => {
    await expect(acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE)).resolves.toBeUndefined();

    const lock = await db.doc(paths.generationLock(HOUSEHOLD_ID, WEEK)).get();
    expect(lock.exists).toBe(true);
    expect(lock.get('by')).toBe(ALICE);
  });

  it('refuse une seconde génération sur la même semaine', async () => {
    // Le cas réel : les deux téléphones appuient à quelques secondes d'écart.
    await acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE);

    await expectHttpsError(
      acquireGenerationLock(HOUSEHOLD_ID, WEEK, BOB),
      'failed-precondition',
    );
  });

  it('laisse passer une génération sur une autre semaine', async () => {
    await acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE);

    await expect(
      acquireGenerationLock(HOUSEHOLD_ID, '2026-09-21', BOB),
    ).resolves.toBeUndefined();
  });

  it('reprend un verrou abandonné', async () => {
    // Une function tuée par son timeout n'a pas pu libérer le sien : sans
    // reprise, le foyer resterait bloqué pour toujours.
    await db.doc(paths.generationLock(HOUSEHOLD_ID, WEEK)).set({
      startedAt: Date.now() - GENERATION_LOCK_TTL_MS - 1_000,
      by: ALICE,
    });

    await expect(acquireGenerationLock(HOUSEHOLD_ID, WEEK, BOB)).resolves.toBeUndefined();
    expect((await db.doc(paths.generationLock(HOUSEHOLD_ID, WEEK)).get()).get('by')).toBe(BOB);
  });

  it('reprend un verrou dont la date est illisible', async () => {
    await db.doc(paths.generationLock(HOUSEHOLD_ID, WEEK)).set({ startedAt: 'hier', by: ALICE });

    await expect(acquireGenerationLock(HOUSEHOLD_ID, WEEK, BOB)).resolves.toBeUndefined();
  });

  it('ne consomme aucun quota en refusant', async () => {
    await acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE);
    await expectHttpsError(acquireGenerationLock(HOUSEHOLD_ID, WEEK, BOB), 'failed-precondition');

    const usage = await db.doc(paths.usageDay(HOUSEHOLD_ID, TODAY)).get();
    expect(usage.exists).toBe(false);
  });
});

describe('releaseGenerationLock', () => {
  const WEEK = '2026-09-14';

  it('rend la semaine disponible', async () => {
    await acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE);
    await releaseGenerationLock(HOUSEHOLD_ID, WEEK);

    await expect(acquireGenerationLock(HOUSEHOLD_ID, WEEK, BOB)).resolves.toBeUndefined();
  });

  it('ne lève jamais, même sans verrou à libérer', async () => {
    await expect(releaseGenerationLock(HOUSEHOLD_ID, WEEK)).resolves.toBeUndefined();
  });
});

describe('reportGenerationStep', () => {
  const WEEK = '2026-09-12';

  it('publie l’étape sur le verrou de la semaine', async () => {
    await acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE);

    await reportGenerationStep(HOUSEHOLD_ID, WEEK, 'generating');

    const lock = await db.doc(paths.generationLock(HOUSEHOLD_ID, WEEK)).get();
    expect(lock.get('step')).toBe('generating');
    expect(lock.get('attempt')).toBe(1);
  });

  it('pose l’étape « preparing » dès la prise du verrou', async () => {
    await acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE);

    const lock = await db.doc(paths.generationLock(HOUSEHOLD_ID, WEEK)).get();
    expect(lock.get('step')).toBe('preparing');
  });

  it('distingue la reprise, qui explique une attente double', async () => {
    await acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE);
    await reportGenerationStep(HOUSEHOLD_ID, WEEK, 'retrying', 2);

    const lock = await db.doc(paths.generationLock(HOUSEHOLD_ID, WEEK)).get();
    expect(lock.get('step')).toBe('retrying');
    expect(lock.get('attempt')).toBe(2);
  });

  it('ne lève jamais si le verrou a disparu', async () => {
    // Perdre l'affichage d'une étape ne doit pas faire échouer la génération.
    await expect(
      reportGenerationStep(HOUSEHOLD_ID, WEEK, 'writing'),
    ).resolves.toBeUndefined();
  });

  it('n’écrit que ce que le schéma partagé décrit', async () => {
    // Le document est lisible par les membres du foyer : y déposer autre chose
    // qu'un code d'étape ferait fuir de l'information technique.
    await acquireGenerationLock(HOUSEHOLD_ID, WEEK, ALICE);
    await reportGenerationStep(HOUSEHOLD_ID, WEEK, 'writing', 2);

    const lock = await db.doc(paths.generationLock(HOUSEHOLD_ID, WEEK)).get();
    expect(GenerationLockSchema.safeParse(lock.data()).success).toBe(true);
    expect(Object.keys(lock.data() ?? {}).sort()).toEqual(['attempt', 'by', 'startedAt', 'step']);
  });
});
