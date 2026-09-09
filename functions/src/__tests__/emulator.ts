/**
 * Branche l'admin SDK sur l'émulateur Firestore.
 *
 * Ce fichier est chargé par Vitest avant tout module de test, donc avant que
 * `lib/firestore.ts` n'appelle `initializeApp()` : c'est la seule fenêtre où
 * `GCLOUD_PROJECT` peut encore être positionné. Les tests s'exécutent via
 * `firebase emulators:exec`, qui fournit `FIRESTORE_EMULATOR_HOST` ; sans lui,
 * on refuse de démarrer plutôt que de risquer d'écrire en production.
 */

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  throw new Error(
    'FIRESTORE_EMULATOR_HOST absent. Lance `npm run test:functions` depuis la racine, ' +
      'qui démarre l’émulateur autour de Vitest.',
  );
}

// `singleProjectMode` est actif dans firebase.json : l'émulateur avertit si un
// autre identifiant de projet lui parle.
export const TEST_PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'dimanche-batch';
process.env.GCLOUD_PROJECT = TEST_PROJECT_ID;

/** Vide la base entre deux tests, via l'API d'administration de l'émulateur. */
export async function clearFirestore(): Promise<void> {
  const url = `http://${emulatorHost}/emulator/v1/projects/${TEST_PROJECT_ID}/databases/(default)/documents`;
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Échec du nettoyage de l’émulateur : ${response.status}`);
  }
}
