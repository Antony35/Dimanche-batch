import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import {
  capitalize,
  formatQuantity,
  type GroceryItem,
  type GroceryOrigin,
} from '@dimanche-batch/shared';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';
import type { Palette } from '@/theme/colors';

export interface GroceryItemRowProps {
  item: GroceryItem;
  onToggle: (item: GroceryItem) => void;
  /** Absent : la ligne n'est pas supprimable. Voir `GroceryItemRow`. */
  onDelete?: ((item: GroceryItem) => void) | undefined;
}

/**
 * Couleur du liséré qui dit d'où vient l'article.
 *
 * Un liséré et non un fond : la liste se lit en un coup d'œil dans un magasin,
 * et trois fonds différents la rendraient bariolée. Le vert est le gros des
 * courses, l'ambre ce qui se cuisine frais le week-end, le gris ce qu'on a
 * ajouté soi-même.
 */
const ORIGIN_COLOR: Record<GroceryOrigin, keyof Palette> = {
  batch: 'accent',
  fresh: 'spice',
  manual: 'inkFaint',
};

/**
 * Une ligne de courses, dimensionnée pour être cochée d'une main dans un
 * magasin : toute la ligne est la cible, pas seulement la case.
 *
 * La poubelle n'apparaît que sur les articles ajoutés à la main. Un article
 * calculé n'est pas supprimable — il reviendrait au prochain recalcul sans
 * qu'on sache pourquoi — et la Security Rule le refuse de toute façon.
 */
export function GroceryItemRow({ item, onToggle, onDelete }: GroceryItemRowProps) {
  const theme = useTheme();
  const isDeletable = item.origin === 'manual' && onDelete !== undefined;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
      <View style={{ width: 3, backgroundColor: theme.colors[ORIGIN_COLOR[item.origin]] }} />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked }}
        accessibilityLabel={`${item.name}, ${formatQuantity(item.qty, item.unit)}`}
        onPress={() => onToggle(item)}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          paddingLeft: theme.spacing.lg - 3,
          paddingRight: theme.spacing.lg,
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

      {isDeletable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retirer ${item.name} de la liste`}
          onPress={() => onDelete(item)}
          style={({ pressed }) => ({
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.lg,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Ionicons name="trash-outline" size={18} color={theme.colors.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}
