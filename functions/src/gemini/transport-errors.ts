/**
 * Classification des échecs de transport vers Gemini.
 *
 * Isolé du client pour être testable sans réseau : c'est la partie la plus
 * fragile, puisqu'elle repose sur la forme des erreurs d'un SDK tiers.
 */

/** Statuts HTTP qui décrivent une indisponibilité passagère, pas une faute. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isRetryableStatus(status: number | null): boolean {
  return status !== null && RETRYABLE_STATUSES.has(status);
}

/**
 * Ce qu'un échec d'appel décide :
 * - `next-model` : ce modèle n'a rien produit, le suivant peut réussir ;
 * - `billing` : le crédit de la clé est épuisé, aucun modèle ne passera ;
 * - `fatal` : une faute de notre côté (schéma refusé…), inutile d'insister.
 */
export type CallFailure =
  | { kind: 'next-model'; dailyQuota: boolean }
  | { kind: 'billing' }
  | { kind: 'fatal' };

/**
 * Classe l'échec d'un appel. Le 429 couvre deux cas que seul le message
 * distingue : une limite par minute, et le quota gratuit du jour atteint
 * (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, 20 requêtes pour
 * `gemini-3.6-flash`, observé le 2026-10-13). Le second ne se lève qu'au
 * lendemain : c'est lui que le message final doit dire.
 *
 * Un 404 passe aussi au modèle suivant : Google ferme des modèles aux comptes
 * récents sans prévenir, et la chaîne doit survivre à l'un d'eux.
 */
export function classifyCallFailure(error: unknown, timedOut: boolean): CallFailure {
  if (timedOut) return { kind: 'next-model', dailyQuota: false };

  const status = httpStatusOf(error);
  if (isBillingStatus(status)) return { kind: 'billing' };
  if (isRetryableStatus(status) || status === 404) {
    const message = error instanceof Error ? error.message : '';
    return { kind: 'next-model', dailyQuota: status === 429 && /PerDay/.test(message) };
  }
  return { kind: 'fatal' };
}

/**
 * Délai accordé à un appel : le temps restant, moins une réserve pour chaque
 * modèle qui reste à essayer après lui. Sans réserve, un premier modèle bloqué
 * consommerait tout le budget et les suivants n'auraient jamais leur chance.
 *
 * Jamais moins de `MIN_CALL_MS`, ni plus que le temps restant : quand le
 * budget est court — la seconde tentative d'une reprise de contenu —, la
 * réserve rendait le délai négatif, et l'appel était annulé avant d'être parti.
 */
export function callTimeoutMs(msLeft: number, modelsAfter: number): number {
  return Math.min(msLeft, Math.max(MIN_CALL_MS, msLeft - MIN_CALL_MS * modelsAfter));
}

/**
 * Plus court délai qu'on accorde à un appel : en deçà, le modèle n'a pas le
 * temps de composer, et l'appel ne ferait que consommer une requête.
 */
export const MIN_CALL_MS = 20_000;

/**
 * Vrai si une nouvelle tentative, après l'attente prévue, a encore le temps
 * d'aboutir avant la fin du budget de la génération.
 */
export function hasTimeForAttempt(msLeft: number, delayMs = 0): boolean {
  return msLeft - delayMs >= MIN_CALL_MS;
}

/**
 * Crédit prépayé épuisé (402), observé en production le 2026-10-12. Rien n'a
 * été généré, mais réessayer ne servirait à rien tant que personne n'a
 * rechargé le compte : on ne réessaie pas, on le dit.
 */
export function isBillingStatus(status: number | null): boolean {
  return status === 402;
}

function propertyOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.get(value, key);
}

/**
 * Statut HTTP d'une erreur du SDK.
 *
 * Le SDK ne l'expose pas de façon stable : selon le chemin d'échec, le code
 * vit sur l'erreur, sous une clé `error`, ou seulement dans le JSON que porte
 * son message. On lit les trois plutôt que de supposer.
 */
export function httpStatusOf(error: unknown): number | null {
  const direct = propertyOf(error, 'status');
  if (typeof direct === 'number') return direct;

  const nested = propertyOf(propertyOf(error, 'error'), 'code');
  if (typeof nested === 'number') return nested;

  if (error instanceof Error) {
    // `(?!\d)` évite de lire « 105 » dans un « 10503 » qui n'est pas un statut.
    const match = /"code"\s*:\s*(\d{3})(?!\d)/.exec(error.message);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}
