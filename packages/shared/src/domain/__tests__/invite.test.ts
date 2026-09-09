import { describe, expect, it } from 'vitest';
import { generateInviteCode, normalizeInviteCode } from '../invite';
import { InviteCodeSchema } from '../../schemas/household';

describe('generateInviteCode', () => {
  it('produit un code accepté par le schéma', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(InviteCodeSchema.safeParse(generateInviteCode()).success).toBe(true);
    }
  });

  it('n’emploie aucun caractère confondable à l’oral ou à l’écrit', () => {
    // Le code se dicte à voix haute : ni O/0, ni I/1/L.
    const codes = Array.from({ length: 300 }, () => generateInviteCode()).join('');
    expect(codes).not.toMatch(/[OIL01]/);
  });

  it('parcourt tout l’alphabet quand la source aléatoire le parcourt', () => {
    const values = [0, 0.5, 0.999, 0];
    let index = 0;
    const code = generateInviteCode(() => values[index++ % values.length] ?? 0);
    expect(code).toBe('BATCH-AS9A');
  });
});

describe('normalizeInviteCode', () => {
  it('accepte la saisie telle qu’elle vient du clavier', () => {
    expect(normalizeInviteCode('batch-7f2k')).toBe('BATCH-7F2K');
    expect(normalizeInviteCode('  BATCH7F2K ')).toBe('BATCH-7F2K');
    expect(normalizeInviteCode('7f2k')).toBe('BATCH-7F2K');
    expect(normalizeInviteCode('7 F 2 K')).toBe('BATCH-7F2K');
  });

  it('ne fabrique pas un code valide à partir de n’importe quoi', () => {
    // Normaliser n'est pas valider : le schéma reste le seul juge.
    expect(InviteCodeSchema.safeParse(normalizeInviteCode('')).success).toBe(false);
    expect(InviteCodeSchema.safeParse(normalizeInviteCode('trop-long-ici')).success).toBe(false);
  });
});
