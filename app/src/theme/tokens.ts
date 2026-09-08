/** Échelle d'espacement en multiples de 4. Aucune marge en dur ailleurs. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 30, fontWeight: '700', lineHeight: 36 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  heading: { fontSize: 17, fontWeight: '600', lineHeight: 23 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodyStrong: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  overline: { fontSize: 11, fontWeight: '700', lineHeight: 14, letterSpacing: 0.8 },
} as const;

export type TypographyVariant = keyof typeof typography;
