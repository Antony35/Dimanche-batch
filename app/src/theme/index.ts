import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './colors';
import { radius, spacing, typography } from './tokens';

export interface Theme {
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  isDark: boolean;
}

/**
 * Unique accès au thème. Un composant qui écrit une couleur en dur contourne
 * le mode sombre : passer par ce hook n'est pas une convention de style, c'est
 * ce qui garantit que l'app reste lisible la nuit.
 */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return {
    colors: isDark ? darkPalette : lightPalette,
    spacing,
    radius,
    typography,
    isDark,
  };
}

export { darkPalette, lightPalette, radius, spacing, typography };
export type { Palette };
export type { TypographyVariant } from './tokens';
