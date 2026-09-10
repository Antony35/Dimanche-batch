import { onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  HouseholdSchema,
  JoinHouseholdInputSchema,
  normalizeInviteCode,
  type JoinHouseholdResult,
} from '@dimanche-batch/shared';
import { DEFAULT_MEMORY, MAX_INSTANCES, REGION } from '../config';
import { db } from '../lib/firestore';
import { internal, invalidArgument, notFound, parseInput } from '../lib/errors';
import { requireAuth } from '../lib/guards';

const MAX_MEMBERS = 8;

/**
 * Rejoindre un foyer via son code d'invitation.
 *
 * Cette opération ne peut pas vivre côté client : trouver le foyer suppose de
 * lire un document dont on n'est pas encore membre, ce que les Security Rules
 * interdisent — à raison. Le code est consommé dans la même transaction que
 * l'ajout du membre, ce qui le rend réellement à usage unique même si les deux
 * téléphones le saisissent en même temps.
 */
export const joinHousehold = onCall(
  { region: REGION, memory: DEFAULT_MEMORY, maxInstances: MAX_INSTANCES },
  async (request): Promise<JoinHouseholdResult> => {
    const uid = requireAuth(request);
    const rawInput = request.data as { inviteCode?: unknown };

    const normalized =
      typeof rawInput?.inviteCode === 'string'
        ? normalizeInviteCode(rawInput.inviteCode)
        : rawInput?.inviteCode;

    const { inviteCode } = parseInput(
      JoinHouseholdInputSchema,
      { inviteCode: normalized },
      'joinHousehold',
    );

    const matches = await db
      .collection(COLLECTIONS.households)
      .where('inviteCode', '==', inviteCode)
      .limit(1)
      .get();

    const doc = matches.docs[0];
    if (!doc) throw notFound('Ce code d’invitation n’existe pas ou a déjà été utilisé.');

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(doc.ref);
      const parsed = HouseholdSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
      if (!parsed.success) throw internal('Foyer corrompu.', parsed.error.issues);

      const household = parsed.data;
      if (household.inviteCode !== inviteCode) {
        throw notFound('Ce code d’invitation vient d’être utilisé.');
      }
      if (household.members.includes(uid)) {
        return { householdId: household.id, name: household.name };
      }
      if (household.members.length >= MAX_MEMBERS) {
        throw invalidArgument('Ce foyer a atteint son nombre maximum de membres.');
      }

      transaction.update(doc.ref, {
        members: [...household.members, uid],
        inviteCode: null,
      });

      return { householdId: household.id, name: household.name };
    });
  },
);
