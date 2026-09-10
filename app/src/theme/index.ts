import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './colors';
import { useThemePreference } from './theme-preference';
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
 *
 * Le choix explicite du foyer prime sur celui du téléphone ; sans choix, on
 * suit le téléphone. La signature ne change pas : les vingt-huit appelants
 * n'ont rien à savoir d'où vient la décision.
 */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  const { preference } = useThemePreference();
  const isDark = preference === 'system' ? scheme === 'dark' : preference === 'dark';
  return {
    colors: isDark ? darkPalette : lightPalette,
    spacing,
    radius,
    typography,
    isDark,
  };
}

export type { TypographyVariant } from './tokens';
export {
  ThemePreferenceProvider,
  useThemePreference,
  type ThemePreference,
} from './theme-preference';
