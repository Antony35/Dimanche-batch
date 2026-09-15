import { View } from 'react-native';
import { Badge, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Ce que veulent dire les couleurs de la liste.
 *
 * Trois origines sans légende, ce sont trois couleurs qu'on interprète de
 * travers une fois sur deux : on croit qu'un article est facultatif parce qu'il
 * n'a pas la couleur du gros de la liste.
 */
export function GroceryLegend() {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      <Badge label="batch" tone="accent" />
      <Text variant="caption" tone="faint">
        cuisiné dimanche
      </Text>
      <Badge label="frais" tone="spice" />
      <Text variant="caption" tone="faint">
        week-end
      </Text>
      <Badge label="ajouté" tone="neutral" />
      <Text variant="caption" tone="faint">
        par vous
      </Text>
    </View>
  );
}
