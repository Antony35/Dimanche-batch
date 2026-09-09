import { DAILY_GENERATION_LIMIT, paths, toIsoDate } from '@dimanche-batch/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firestore';
import { internal, permissionDenied, resourceExhausted } from './errors';

/**
 * Toute callable commence par ces deux garde-fous. Les Security Rules protègent
 * les accès directs à Firestore ; elles ne s'appliquent pas à l'admin SDK, donc
 * l'appartenance au foyer doit être revérifiée ici, à chaque appel.
 */

/**
 * Le guard ne demande que ce dont il se sert. Un `CallableRequest` complet
 * reste assignable — c'est ce que passent les callables — mais un test peut
 * l'appeler sans fabriquer un jeton d'identité décodé de toutes pièces.
 */
export function requireAuth(request: { auth?: { uid?: string } }): string {
  const uid = request.auth?.uid;
  if (!uid) throw permissionDenied('Connecte-toi pour continuer.');
  return uid;
}

export async function requireHouseholdMember(uid: string, householdId: string): Promise<void> {
  let snapshot;
  try {
    snapshot = await db.doc(paths.household(householdId)).get();
  } catch (error) {
    // Un refus de Firestore ici ne vient pas des Security Rules — l'admin SDK
    // n'y est pas soumis — mais des droits IAM du compte de service qui exécute
    // la function. Le distinguer évite de chercher le problème dans les règles.
    throw internal(
      "Le service n'a pas accès à la base de données. Vérifie que le compte de " +
        'service des functions porte le rôle « Utilisateur Cloud Datastore ».',
      error,
    );
  }

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
      // Un compteur absent ou corrompu vaut zéro. Sans ce garde-fou, une valeur
      // non numérique rendrait la comparaison au plafond toujours fausse et
      // ouvrirait le quota en grand.
      const stored: unknown = snapshot.get('generations');
      const current = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;

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
