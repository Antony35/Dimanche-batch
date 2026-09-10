import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { Recipe } from '@dimanche-batch/shared';
import { Card, Tag, Text } from '@/components/ui';
import { useTheme } from '@/theme';

export interface PreferenceCardProps {
  recipe: Recipe;
  verdict: 'favorite' | 'banned';
  /** Lève le verdict — retire des favoris, ou rétablit un plat banni. */
  onToggle: () => void;
}

/**
 * Une recette et le jugement que le foyer porte sur elle.
 *
 * La carte ouvre la fiche, le bouton lève le verdict. Sans ce bouton, retirer
 * un favori obligerait à ouvrir la recette pour y trouver le cœur — la liste
 * ne servirait qu'à regarder.
 */
export function PreferenceCard({ recipe, verdict, onToggle }: PreferenceCardProps) {
  const theme = useTheme();
  const router = useRouter();

  const isFavorite = verdict === 'favorite';

  return (
    <Card onPress={() => router.push(`/recette/${recipe.id}`)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons
          name={isFavorite ? 'heart' : 'close-circle'}
          size={16}
          color={isFavorite ? theme.colors.spice : theme.colors.danger}
        />
        <Text variant="heading" style={{ flex: 1 }}>
          {recipe.name}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isFavorite ? `Retirer ${recipe.name} des favoris` : `Reproposer ${recipe.name}`
          }
          hitSlop={12}
          onPress={onToggle}
        >
          <Text variant="caption" tone="accent">
            {isFavorite ? 'Retirer' : 'Rétablir'}
          </Text>
        </Pressable>
      </View>

      <Text variant="caption" tone="soft">
        {recipe.prepMinutes} min · {recipe.servings} portions
      </Text>

      {recipe.tags.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
          {recipe.tags.map((tag) => (
            <Tag key={tag} tag={tag} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}
