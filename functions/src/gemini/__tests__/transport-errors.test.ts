import { describe, expect, it } from 'vitest';
import { httpStatusOf, isRetryableStatus } from '../transport-errors';

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
    // 400 : schéma refusé. 404 : modèle fermé. 403 : clé invalide.
    // Réessayer ne ferait que consommer du quota pour rien.
    for (const status of [400, 401, 403, 404]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
    expect(isRetryableStatus(null)).toBe(false);
  });
});
