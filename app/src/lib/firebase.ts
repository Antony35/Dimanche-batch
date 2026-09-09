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
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
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

const firebaseApp = createApp();

/**
 * `initializeAuth` avec la persistance AsyncStorage, et non `getAuth` : sans ça
 * la session est perdue à chaque redémarrage de l'app et il faut se reconnecter
 * en permanence.
 */
export const auth: Auth = initializeAuth(firebaseApp, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db: Firestore = getFirestore(firebaseApp);
export const functions: Functions = getFunctions(firebaseApp, FUNCTIONS_REGION);

if (env.useEmulators) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
}
