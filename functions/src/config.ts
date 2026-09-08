import { defineSecret, defineString } from 'firebase-functions/params';

/**
 * La clé Gemini est un secret Google Secret Manager, jamais une variable
 * d'environnement en clair et jamais un fichier du dépôt. Elle se déploie avec :
 *
 *   firebase functions:secrets:set GEMINI_API_KEY
 *
 * Sa valeur n'est lisible qu'à l'intérieur d'une function qui la déclare
 * explicitement dans `secrets: [GEMINI_API_KEY]`.
 */
export const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

/** Modèle par défaut, surchargeable sans redéployer le code. */
export const GEMINI_MODEL = defineString('GEMINI_MODEL', {
  default: 'gemini-2.5-flash',
});

/** Toutes les functions vivent dans la même région que Firestore. */
export const REGION = 'europe-west1';

/** Garde-fou de coût : une génération dépasse rarement 30 s. */
export const DEFAULT_TIMEOUT_SECONDS = 120;
export const DEFAULT_MEMORY = '512MiB' as const;

/**
 * Plafond d'instances concurrentes.
 *
 * Un budget Google Cloud n'est qu'une alerte : il ne coupe rien. La seule
 * chose qui borne réellement la dépense est ce qui borne l'exécution. Deux
 * utilisateurs n'ont jamais besoin de plus de quelques instances ; au-delà,
 * c'est une boucle ou une avalanche de retries, pas un usage légitime.
 */
export const MAX_INSTANCES = 3;
