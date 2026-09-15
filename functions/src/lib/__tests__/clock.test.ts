import { describe, expect, it } from 'vitest';
import { todayInParis } from '../clock';

describe('todayInParis', () => {
  // Le cas qui justifie le fichier : vendredi 23 h 30 UTC, c'est déjà samedi
  // en France l'été, et la semaine vient de commencer.
  it('passe au samedi à minuit à Paris, pas à minuit UTC', () => {
    expect(todayInParis(new Date('2026-09-18T22:30:00Z'))).toBe('2026-09-19');
    expect(todayInParis(new Date('2026-09-18T21:30:00Z'))).toBe('2026-09-18');
  });

  it('tient compte de l’heure d’hiver', () => {
    expect(todayInParis(new Date('2026-12-18T23:30:00Z'))).toBe('2026-12-19');
    expect(todayInParis(new Date('2026-12-18T22:30:00Z'))).toBe('2026-12-18');
  });
});
