import { z } from 'zod';

/**
 * Configuration cliente, validée au démarrage.
 *
 * Une variable manquante doit provoquer une erreur immédiate et lisible, pas un
 * `auth/invalid-api-key` obscur au premier login. Rien de secret ici : ces
 * valeurs identifient le projet Firebase et sont publiques par nature — la
 * protection vient des Security Rules. La clé Gemini n'apparaît jamais dans
 * l'app (voir CLAUDE.md §4).
 */
const EnvSchema = z.object({
  firebaseApiKey: z.string().min(1),
  firebaseAuthDomain: z.string().min(1),
  firebaseProjectId: z.string().min(1),
  firebaseStorageBucket: z.string().min(1),
  firebaseMessagingSenderId: z.string().min(1),
  firebaseAppId: z.string().min(1),
  useEmulators: z.boolean(),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse({
  firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  useEmulators: process.env.EXPO_PUBLIC_USE_EMULATORS === '1',
});

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(
    `Configuration Firebase incomplète (${missing}). Copie app/.env.example vers app/.env et renseigne les valeurs du projet.`,
  );
}

export const env: Env = parsed.data;

/** Hôte des émulateurs vu depuis l'appareil : `localhost` ne sort pas du téléphone. */
export const EMULATOR_HOST = process.env.EXPO_PUBLIC_EMULATOR_HOST ?? '10.0.2.2';
