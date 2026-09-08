import type { CallableRequest } from 'firebase-functions/v2/https';
import { DAILY_GENERATION_LIMIT, paths, toIsoDate } from '@dimanche-batch/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firestore';
import { internal, permissionDenied, resourceExhausted } from './errors';

/**
 * Toute callable commence par ces deux garde-fous. Les Security Rules protègent
 * les accès directs à Firestore ; elles ne s'appliquent pas à l'admin SDK, donc
 * l'appartenance au foyer doit être revérifiée ici, à chaque appel.
 */

export function requireAuth(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) throw permissionDenied('Connecte-toi pour continuer.');
  return uid;
}

export async function requireHouseholdMember(uid: string, householdId: string): Promise<void> {
  const snapshot = await db.doc(paths.household(householdId)).get();
  if (!snapshot.exists) throw permissionDenied('Ce foyer est introuvable.');

  const members = snapshot.get('members');
  if (!Array.isArray(members) || !members.includes(uid)) {
    throw permissionDenied();
  }
}

/**
 * Plafond de générations par foyer et par jour.
 *
 * La clé Gemini est partagée par le foyer : une boucle de retry mal écrite ou
 * un doigt qui insiste sur « Régénérer » consommerait le quota en quelques
 * secondes. Le compteur est incrémenté dans une transaction pour rester juste
 * même si les deux téléphones lancent une génération en même temps.
 */
export async function consumeGenerationQuota(householdId: string): Promise<number> {
  const today = toIsoDate(new Date());
  const usageRef = db.doc(paths.usageDay(householdId, today));

  try {
    return await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(usageRef);
      const current = (snapshot.get('generations') as number | undefined) ?? 0;

      if (current >= DAILY_GENERATION_LIMIT) {
        throw resourceExhausted(
          `Limite de ${DAILY_GENERATION_LIMIT} générations par jour atteinte. Réessaie demain.`,
        );
      }

      transaction.set(
        usageRef,
        { generations: FieldValue.increment(1), updatedAt: Date.now() },
        { merge: true },
      );
      return current + 1;
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error;
    throw internal('Impossible de vérifier le quota de génération.', error);
  }
}
