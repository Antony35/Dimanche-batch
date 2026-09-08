import type { InviteCode } from '../schemas/household';

/**
 * Alphabet sans caractères confondables (ni 0/O, ni 1/I/L) : le code se dicte
 * à voix haute entre deux personnes dans la même pièce.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

export function generateInviteCode(random: () => number = Math.random): InviteCode {
  let suffix = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    suffix += ALPHABET[Math.floor(random() * ALPHABET.length)] ?? 'A';
  }
  return `BATCH-${suffix}`;
}

/** Tolère la saisie sans préfixe, en minuscules ou avec des espaces. */
export function normalizeInviteCode(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '').replace(/^BATCH-?/, '');
  return `BATCH-${cleaned}`;
}
