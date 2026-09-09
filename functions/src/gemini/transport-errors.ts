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
