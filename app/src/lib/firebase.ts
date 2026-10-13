import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
// Import depuis `@firebase/auth` et non `firebase/auth` : seul le premier
// expose `getReactNativePersistence`, via sa condition d'export "react-native".
// Le package meta `firebase` ne publie que la variante navigateur.
import {
  connectAuthEmulator,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from '@firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { EMULATOR_HOST, env } from './env';

/** Doit rester identique à `REGION` dans functions/src/config.ts. */
const FUNCTIONS_REGION = 'europe-west1';

function createApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp({
    apiKey: env.firebaseApiKey,
    authDomain: env.firebaseAuthDomain,
    projectId: env.firebaseProjectId,
    storageBucket: env.firebaseStorageBucket,
    messagingSenderId: env.firebaseMessagingSenderId,
    appId: env.firebaseAppId,
  });
}

// Lu avant `createApp` : un rechargement à chaud réévalue ce module sur une
// app déjà initialisée, et `initializeFirestore` refuse d'être appelé deux fois.
const isFirstInit = getApps().length === 0;
const firebaseApp = createApp();

/**
 * `initializeAuth` avec la persistance AsyncStorage, et non `getAuth` : sans ça
 * la session est perdue à chaque redémarrage de l'app et il faut se reconnecter
 * en permanence.
 */
export const auth: Auth = initializeAuth(firebaseApp, {
  persistence: getReactNativePersistence(AsyncStorage),
});

/**
 * Long polling forcé, et non le flux WebChannel par défaut.
 *
 * Sous React Native, le réseau garde en tampon la réponse en streaming : ce
 * qu'écrit le serveur — le plan qu'une function vient de composer — n'arrivait
 * au listener qu'au prochain échange, typiquement en changeant d'onglet. Nos
 * propres écritures, appliquées localement d'abord, masquaient le défaut. Le
 * long polling rend chaque réponse dès qu'elle arrive.
 */
export const db: Firestore = isFirstInit
  ? initializeFirestore(firebaseApp, { experimentalForceLongPolling: true })
  : getFirestore(firebaseApp);
export const functions: Functions = getFunctions(firebaseApp, FUNCTIONS_REGION);

if (env.useEmulators) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
}
