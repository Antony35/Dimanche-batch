import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';
import {
  AISLE_LABELS,
  capitalize,
  formatQuantity,
  type Ingredient,
} from '@dimanche-batch/shared';
import { Card, EmptyState, ErrorState, LoadingState, Screen, Tag, Text } from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import {
  useToggleDislike,
  useToggleFavorite,
} from '@/features/recipes/api/use-recipe-verdict';
import { useTheme } from '@/theme';

/** Fiche complète d'une recette : ce qu'il faut acheter, et quoi en faire. */
export default function RecipeScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { household } = useHousehold();

  const householdId = household?.id ?? null;
  const { recipesById, isLoading } = useRecipes(householdId);
  const favorite = useToggleFavorite();
  const dislike = useToggleDislike();

  const recipe = recipesById.get(id);

  if (isLoading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (!recipe) {
    return (
      <Screen>
        <EmptyState
          title="Recette introuvable"
          description="Elle a peut-être été remplacée par une régénération."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {favorite.error || dislike.error ? (
        <ErrorState message="Ton choix n’a pas pu être enregistré. Vérifie ta connexion." />
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
          <Text variant="title" style={{ flex: 1 }}>
            {recipe.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recipe.isFavorite ? 'Retirer des favoris' : 'Mettre en favori'}
            accessibilityState={{ selected: recipe.isFavorite }}
            hitSlop={12}
            onPress={() => {
              if (householdId) {
                favorite.mutate({ householdId, recipeId: recipe.id, isFavorite: !recipe.isFavorite });
              }
            }}
          >
            <Ionicons
              name={recipe.isFavorite ? 'heart' : 'heart-outline'}
              size={28}
              color={recipe.isFavorite ? theme.colors.spice : theme.colors.inkFaint}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              recipe.isDisliked ? 'Reproposer ce plat' : 'Ne plus jamais proposer ce plat'
            }
            accessibilityState={{ selected: recipe.isDisliked }}
            hitSlop={12}
            onPress={() => {
              if (householdId) {
                dislike.mutate({
                  householdId,
                  recipeId: recipe.id,
                  isDisliked: !recipe.isDisliked,
                });
              }
            }}
          >
            <Ionicons
              name={recipe.isDisliked ? 'close-circle' : 'close-circle-outline'}
              size={28}
              color={recipe.isDisliked ? theme.colors.danger : theme.colors.inkFaint}
            />
          </Pressable>
        </View>

        {recipe.isDisliked ? (
          <Text variant="caption" style={{ color: theme.colors.danger }}>
            Ce plat ne sera plus proposé. Il peut rester au menu de la semaine en cours — change
            le repas depuis le planning.
          </Text>
        ) : null}

        <Text tone="soft">
          {recipe.prepMinutes} min · {recipe.servings} portions
          {recipe.lastUsedAt ? ` · servie la semaine du ${recipe.lastUsedAt}` : ''}
        </Text>

        {recipe.tags.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {recipe.tags.map((tag) => (
              <Tag key={tag} tag={tag} />
            ))}
          </View>
        ) : null}
      </View>

      <Card>
        <Text variant="overline" tone="faint">
          INGRÉDIENTS · {recipe.servings} PORTIONS
        </Text>
        {recipe.ingredients.map((ingredient, index) => (
          <IngredientLine key={`${ingredient.name}-${index}`} ingredient={ingredient} />
        ))}
      </Card>

      <Card>
        <Text variant="overline" tone="faint">
          PRÉPARATION
        </Text>
        {recipe.steps.map((step, index) => (
          <View
            key={step}
            style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm }}
          >
            <Text variant="bodyStrong" tone="accent" style={{ minWidth: 20 }}>
              {index + 1}
            </Text>
            <Text style={{ flex: 1 }}>{step}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function IngredientLine({ ingredient }: { ingredient: Ingredient }) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: theme.spacing.sm,
        marginTop: theme.spacing.xs,
      }}
    >
      <Text style={{ flex: 1 }}>{capitalize(ingredient.name)}</Text>
      <Text variant="caption" tone="faint">
        {AISLE_LABELS[ingredient.aisle]}
      </Text>
      <Text variant="bodyStrong">{formatQuantity(ingredient.qty, ingredient.unit)}</Text>
    </View>
  );
}

