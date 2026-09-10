import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { Recipe, RecipeVerdict } from '@dimanche-batch/shared';
import { Card, Tag, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Ce que chaque verdict porte à l'écran. La teinte est une clé du thème et non
 * une couleur : une valeur en dur ici contournerait le mode sombre.
 */
const MARKS: Record<
  RecipeVerdict,
  { icon: 'heart' | 'close-circle'; tone: 'spice' | 'danger'; action: string }
> = {
  favorite: { icon: 'heart', tone: 'spice', action: 'Retirer' },
  banned: { icon: 'close-circle', tone: 'danger', action: 'Rétablir' },
};

export interface PreferenceCardProps {
  recipe: Recipe;
  verdict: RecipeVerdict;
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
  const mark = MARKS[verdict];

  return (
    <Card onPress={() => router.push(`/recette/${recipe.id}`)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name={mark.icon} size={16} color={theme.colors[mark.tone]} />
        <Text variant="heading" style={{ flex: 1 }}>
          {recipe.name}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${mark.action} ${recipe.name}`}
          hitSlop={12}
          onPress={onToggle}
        >
          <Text variant="caption" tone="accent">
            {mark.action}
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
