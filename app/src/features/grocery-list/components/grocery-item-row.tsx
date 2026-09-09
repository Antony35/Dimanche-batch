import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';
import { formatQuantity, type GroceryItem } from '@dimanche-batch/shared';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

export interface GroceryItemRowProps {
  item: GroceryItem;
  onToggle: (item: GroceryItem) => void;
}

/**
 * Une ligne de courses, dimensionnée pour être cochée d'une main dans un
 * magasin : toute la ligne est la cible, pas seulement la case.
 */
export function GroceryItemRow({ item, onToggle }: GroceryItemRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.checked }}
      accessibilityLabel={`${item.name}, ${formatQuantity(item.qty, item.unit)}`}
      onPress={() => onToggle(item)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        minHeight: 52,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={item.checked ? 'checkbox' : 'square-outline'}
        size={24}
        color={item.checked ? theme.colors.accent : theme.colors.inkFaint}
      />

      <Text
        variant="body"
        tone={item.checked ? 'faint' : 'default'}
        style={{
          flex: 1,
          textDecorationLine: item.checked ? 'line-through' : 'none',
        }}
      >
        {capitalize(item.name)}
      </Text>

      <Text variant="caption" tone={item.checked ? 'faint' : 'soft'}>
        {formatQuantity(item.qty, item.unit)}
      </Text>
    </Pressable>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
