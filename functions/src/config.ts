import { defineSecret } from 'firebase-functions/params';
import { CALLABLE_TIMEOUT_SECONDS } from '@dimanche-batch/shared';

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

/**
 * Modèle utilisé pour la génération.
 *
 * Constante et non paramètre de déploiement : changer de modèle change la
 * qualité des plans produits, donc c'est une décision qui mérite un commit et
 * une revue, pas un réglage qu'on pousse sans trace. La valeur est enregistrée
 * avec chaque plan, ce qui permet de comparer après coup.
 *
 * Attention avant de modifier cette valeur : un modèle listé par
 * `GET /v1beta/models` n'est pas forcément accessible. Google continue de
 * publier des modèles fermés aux comptes récents, qui répondent alors
 * « no longer available to new users » avec un 404. La seule vérification
 * fiable est un appel réel à `generateContent`.
 */
/*
 * Chaîne de modèles, essayés dans l'ordre : on passe au suivant dès qu'un
 * modèle n'a rien produit (saturé, quota du jour atteint, délai dépassé, fermé).
 *
 * Mesuré le 2026-10-13. `gemini-3.6-flash` donne les meilleurs plans mais
 * refusait environ neuf appels sur dix (503), et son palier gratuit plafonne à
 * 20 requêtes par jour. `gemini-3.5-flash-lite` a répondu 7 fois sur 7 en 2 à
 * 8 s, mais ratait au premier jet des règles du plan (congélation, mijoté) que
 * la reprise de contenu doit rattraper. `gemini-3.1-flash-lite` a répondu 13
 * fois sur 16, en 10 à 18 s, avec six plans sur neuf conformes d'emblée.
 * `gemini-2.5-flash-lite` répond 404 aux comptes récents.
 *
 * Les quotas gratuits sont comptés par modèle : quand l'un est épuisé pour la
 * journée, les suivants ne le sont pas.
 */
export const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
] as const;

/** Toutes les functions vivent dans la même région que Firestore. */
export const REGION = 'europe-west1';

/** Garde-fou de coût : une génération dépasse rarement 30 s. */
export const DEFAULT_TIMEOUT_SECONDS = CALLABLE_TIMEOUT_SECONDS;

/**
 * Temps accordé à Gemini dans une génération, reprises comprises.
 *
 * Le 2026-10-13, un appel est resté bloqué 2 min 37 avant de répondre 503 : la
 * function a été coupée à 120 s sans rendre la génération ni dire quoi faire.
 * Au-delà de ce budget, l'appel en cours est annulé et la génération rendue.
 * Vingt secondes restent pour écrire le plan, ou rembourser et répondre.
 */
export const GEMINI_BUDGET_MS = DEFAULT_TIMEOUT_SECONDS * 1_000 - 20_000;
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
