import { View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './text';

/**
 * Les familles de couleur de la palette, telles qu'un composant peut les
 * demander. Chacune a un fond doux et une encre lisible dessus, définis dans
 * les deux thèmes.
 */
export type BadgeTone = 'accent' | 'spice' | 'weekend' | 'neutral' | 'danger';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: ViewStyle;
}

/**
 * Pastille générique.
 *
 * `Tag` existait déjà mais il est figé sur `RecipeTag` : ses libellés et ses
 * couleurs sont une table fermée, et la liste de courses a besoin de la même
 * mise en forme pour dire d'où vient un article. Le fond et l'encre vivent donc
 * ici, et `Tag` ne garde que ce qui lui est propre — la traduction d'une
 * étiquette de recette en couleur.
 */
export function Badge({ label, tone = 'accent', style }: BadgeProps) {
  const theme = useTheme();

  const schemes: Record<BadgeTone, { bg: string; fg: string }> = {
    accent: { bg: theme.colors.accentSoft, fg: theme.colors.accent },
    spice: { bg: theme.colors.spiceSoft, fg: theme.colors.spiceInk },
    weekend: { bg: theme.colors.weekendSoft, fg: theme.colors.weekend },
    neutral: { bg: theme.colors.lineSoft, fg: theme.colors.inkSoft },
    danger: { bg: theme.colors.dangerSoft, fg: theme.colors.danger },
  };
  const scheme = schemes[tone];

  return (
    <View
      style={[
        {
          backgroundColor: scheme.bg,
          borderRadius: theme.radius.sm,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 3,
        },
        style,
      ]}
    >
      <Text variant="overline" style={{ color: scheme.fg }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
