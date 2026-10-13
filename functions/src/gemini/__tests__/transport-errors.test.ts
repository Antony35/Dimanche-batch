import { describe, expect, it } from 'vitest';
import {
  MIN_CALL_MS,
  callTimeoutMs,
  classifyCallFailure,
  hasTimeForAttempt,
  httpStatusOf,
  isBillingStatus,
  isRetryableStatus,
} from '../transport-errors';

/**
 * Le SDK Gemini n'expose pas son statut HTTP de façon stable. Ces tests fixent
 * les trois formes rencontrées, dont celle observée en production le
 * 2026-09-09 : un `ApiError` dont le message est le JSON de l'erreur.
 */

describe('httpStatusOf', () => {
  it('lit le statut posé directement sur l’erreur', () => {
    expect(httpStatusOf(Object.assign(new Error('boom'), { status: 503 }))).toBe(503);
  });

  it('lit le statut imbriqué sous `error`', () => {
    expect(httpStatusOf({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } })).toBe(429);
  });

  it('extrait le statut du message, forme observée en production', () => {
    const error = new Error(
      '{"error":{"code":503,"message":"This model is currently experiencing high demand.' +
        ' Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}',
    );
    expect(httpStatusOf(error)).toBe(503);
  });

  it('rend `null` quand rien ne ressemble à un statut', () => {
    expect(httpStatusOf(new Error('socket hang up'))).toBeNull();
    expect(httpStatusOf('une chaîne')).toBeNull();
    expect(httpStatusOf(null)).toBeNull();
    expect(httpStatusOf(undefined)).toBeNull();
  });

  it('extrait le 402 du crédit épuisé, forme observée en production le 2026-10-12', () => {
    const error = new Error(
      '{"error":{"code":402,"message":"Your prepayment credits are depleted.","status":' +
        '"RESOURCE_EXHAUSTED"}}',
    );
    expect(httpStatusOf(error)).toBe(402);
  });

  it('ne confond pas un nombre à quatre chiffres avec un statut', () => {
    expect(httpStatusOf(new Error('{"code":10503}'))).toBeNull();
  });
});

describe('isRetryableStatus', () => {
  it('réessaie sur saturation et panne passagère', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it('ne réessaie jamais sur une erreur de notre fait', () => {
    // 400 : schéma refusé. 404 : modèle fermé. 403 : clé invalide. 402 : crédit épuisé.
    // Réessayer ne ferait que consommer du quota pour rien.
    for (const status of [400, 401, 402, 403, 404]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
    expect(isRetryableStatus(null)).toBe(false);
  });
});

describe('isBillingStatus', () => {
  it('reconnaît le crédit épuisé, et lui seul', () => {
    expect(isBillingStatus(402)).toBe(true);
    for (const status of [400, 403, 429, 503]) {
      expect(isBillingStatus(status)).toBe(false);
    }
    expect(isBillingStatus(null)).toBe(false);
  });
});

/**
 * Le 2026-10-13, un appel est resté bloqué 2 min 37 : la function a été coupée
 * avant d'avoir rendu la génération. Une tentative n'est lancée que si elle a
 * le temps d'aboutir.
 */
describe('hasTimeForAttempt', () => {
  it('lance une tentative qui a le temps d’aboutir', () => {
    expect(hasTimeForAttempt(60_000)).toBe(true);
    expect(hasTimeForAttempt(MIN_CALL_MS)).toBe(true);
  });

  it('renonce quand le budget restant est trop court', () => {
    expect(hasTimeForAttempt(MIN_CALL_MS - 1)).toBe(false);
    expect(hasTimeForAttempt(-5_000)).toBe(false);
  });

  it('compte l’attente avant la reprise', () => {
    expect(hasTimeForAttempt(MIN_CALL_MS + 3_000, 3_000)).toBe(true);
    expect(hasTimeForAttempt(MIN_CALL_MS + 2_999, 3_000)).toBe(false);
  });
});

describe('classifyCallFailure', () => {
  const apiError = (code: number, extra = '') =>
    new Error(`{"error":{"code":${code},"message":"…${extra}","status":"X"}}`);

  // Forme observée en production le 2026-10-13 : le quota gratuit du jour.
  const dailyQuota = apiError(
    429,
    'Quota exceeded … model: gemini-3.6-flash","details":[{"quotaId":' +
      '"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]',
  );

  it('passe au modèle suivant quand celui-ci n’a rien produit', () => {
    for (const code of [500, 502, 503, 504]) {
      expect(classifyCallFailure(apiError(code), false)).toEqual({
        kind: 'next-model',
        dailyQuota: false,
      });
    }
    expect(classifyCallFailure(new Error('aborted'), true)).toEqual({
      kind: 'next-model',
      dailyQuota: false,
    });
  });

  it('distingue le quota du jour d’une limite par minute', () => {
    expect(classifyCallFailure(dailyQuota, false)).toEqual({
      kind: 'next-model',
      dailyQuota: true,
    });
    expect(classifyCallFailure(apiError(429, 'PerMinute'), false)).toEqual({
      kind: 'next-model',
      dailyQuota: false,
    });
  });

  // Google ferme des modèles aux comptes récents : la chaîne doit y survivre.
  it('passe au suivant sur un modèle fermé', () => {
    expect(classifyCallFailure(apiError(404), false).kind).toBe('next-model');
  });

  it('s’arrête sur un crédit épuisé, commun à tous les modèles', () => {
    expect(classifyCallFailure(apiError(402), false)).toEqual({ kind: 'billing' });
  });

  // Forme observée en production le 2026-10-13 : un identifiant de projet
  // collé à la place de la clé.
  it('reconnaît une clé refusée, commune à tous les modèles', () => {
    const invalid = apiError(
      400,
      'API key not valid. Please pass a valid API key.","reason":"API_KEY_INVALID',
    );
    expect(classifyCallFailure(invalid, false)).toEqual({ kind: 'invalid-key' });
    expect(classifyCallFailure(apiError(403), false)).toEqual({ kind: 'invalid-key' });
  });

  it('ne masque pas une faute de notre côté', () => {
    expect(classifyCallFailure(apiError(400), false)).toEqual({ kind: 'fatal' });
    expect(classifyCallFailure(new Error('socket hang up'), false)).toEqual({ kind: 'fatal' });
  });
});

describe('callTimeoutMs', () => {
  it('réserve du temps à chaque modèle qui reste à essayer', () => {
    expect(callTimeoutMs(100_000, 2)).toBe(100_000 - 2 * MIN_CALL_MS);
    expect(callTimeoutMs(100_000, 0)).toBe(100_000);
  });

  // Trouvé à l'audit : à 30 s restantes, deux modèles derrière rendaient -10 s.
  it('laisse toujours à l’appel en cours le temps minimal, sans dépasser le budget', () => {
    expect(callTimeoutMs(30_000, 2)).toBe(MIN_CALL_MS);
    expect(callTimeoutMs(MIN_CALL_MS - 5_000, 2)).toBe(MIN_CALL_MS - 5_000);
  });
});
