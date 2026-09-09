import { Fragment } from 'react';
import { View } from 'react-native';
import { AISLE_LABELS, type Aisle, type GroceryItem } from '@dimanche-batch/shared';
import { Card, Text } from '@/components/ui';
import { useTheme } from '@/theme';
import { GroceryItemRow } from './grocery-item-row';

export interface AisleSectionProps {
  aisle: Aisle;
  items: GroceryItem[];
  onToggle: (item: GroceryItem) => void;
}

/**
 * Un rayon du magasin. L'ordre des rayons est celui d'`AISLES`, qui suit un
 * parcours de magasin — on ne revient pas sur ses pas entre deux articles.
 */
export function AisleSection({ aisle, items, onToggle }: AisleSectionProps) {
  const theme = useTheme();
  const remaining = items.filter((item) => !item.checked).length;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
        <Text variant="overline" tone="faint">
          {AISLE_LABELS[aisle].toUpperCase()}
        </Text>
        <Text variant="caption" tone="faint">
          {remaining === 0 ? 'terminé' : `${remaining} sur ${items.length}`}
        </Text>
      </View>

      <Card style={{ padding: 0, gap: 0 }}>
        {items.map((item, index) => (
          <Fragment key={item.id}>
            {index > 0 ? (
              <View
                style={{
                  height: 1,
                  backgroundColor: theme.colors.lineSoft,
                  marginLeft: theme.spacing.lg + 24 + theme.spacing.md,
                }}
              />
            ) : null}
            <GroceryItemRow item={item} onToggle={onToggle} />
          </Fragment>
        ))}
      </Card>
    </View>
  );
}
