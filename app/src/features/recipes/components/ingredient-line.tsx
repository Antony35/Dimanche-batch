import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { AISLE_LABELS, capitalize, formatQuantity, type Ingredient } from '@dimanche-batch/shared';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Une ligne d'ingrédient, partagée par la fiche recette et l'écran du batch.
 *
 * Touchable quand on lui passe `onPress` — l'écran du batch, tant qu'il n'est
 * pas cuisiné : toute la ligne répond, pas seulement une icône, parce qu'on la
 * vise le pouce en cuisine. Un ingrédient remplacé dit ce que la recette
 * demandait, partout où il s'affiche.
 */
export function IngredientLine({
  ingredient,
  onPress,
}: {
  ingredient: Ingredient;
  onPress?: (() => void) | undefined;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `Remplacer ${ingredient.name}` : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text>{capitalize(ingredient.name)}</Text>
        {ingredient.originalName ? (
          <Text variant="caption" tone="accent">
            au lieu de {ingredient.originalName}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" tone="faint">
        {AISLE_LABELS[ingredient.aisle]}
      </Text>
      <Text variant="bodyStrong">{formatQuantity(ingredient.qty, ingredient.unit)}</Text>
      {onPress ? <Ionicons name="swap-horizontal" size={16} color={theme.colors.inkFaint} /> : null}
    </Pressable>
  );
}

/**
 * Rappel des remplacements au-dessus des étapes, qui ne sont pas réécrites :
 * « courgette → aubergine ». Rien quand la recette n'a rien de remplacé.
 */
export function SubstitutionNote({ ingredients }: { ingredients: readonly Ingredient[] }) {
  const substituted = ingredients.filter((ingredient) => ingredient.originalName);
  if (substituted.length === 0) return null;

  return (
    <Text variant="caption" tone="soft">
      Les étapes suivent la recette d’origine :{' '}
      {substituted
        .map((ingredient) => `${ingredient.originalName} → ${ingredient.name}`)
        .join(', ')}
      .
    </Text>
  );
}
