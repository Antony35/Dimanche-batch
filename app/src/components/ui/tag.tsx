import { View } from 'react-native';
import type { RecipeTag } from '@dimanche-batch/shared';
import { useTheme } from '@/theme';
import { Text } from './text';

const TAG_LABELS: Record<RecipeTag, string> = {
  'one-pot': 'one-pot',
  healthy: 'healthy',
  congelable: 'congèle',
  rapide: 'rapide',
  vegetarien: 'végé',
  batch: 'batch',
  weekend: 'week-end',
  entree: 'entrée',
  dessert: 'dessert',
};

export interface TagProps {
  tag: RecipeTag;
}

/** Les trois familles de couleur reprennent la légende du plan de projet. */
export function Tag({ tag }: TagProps) {
  const theme = useTheme();

  const scheme =
    tag === 'congelable'
      ? { bg: theme.colors.spiceSoft, fg: theme.colors.spiceInk }
      : tag === 'weekend'
        ? { bg: theme.colors.weekendSoft, fg: theme.colors.weekend }
        : { bg: theme.colors.accentSoft, fg: theme.colors.accent };

  return (
    <View
      style={{
        backgroundColor: scheme.bg,
        borderRadius: theme.radius.sm,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 3,
      }}
    >
      <Text variant="overline" style={{ color: scheme.fg }}>
        {TAG_LABELS[tag].toUpperCase()}
      </Text>
    </View>
  );
}
