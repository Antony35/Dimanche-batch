import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { type Recipe, type WeeklyPlan } from '@dimanche-batch/shared';
import { Card, EmptyState, ErrorState, LoadingState, Screen, Tag, Text } from '@/components/ui';
import { useWeekHistory } from '@/features/history/api/use-week-history';
import { useHousehold } from '@/features/household/api/use-household';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useTheme } from '@/theme';

/**
 * Mémoire du foyer : les semaines déjà composées, et les recettes qu'on veut
 * revoir. C'est ce que le prompt consulte pour ne pas se répéter.
 */
export default function HistoryScreen() {
  const theme = useTheme();
  const { household } = useHousehold();

  const householdId = household?.id ?? null;
  const { weeks, isLoading, error } = useWeekHistory(householdId);
  const { recipesById } = useRecipes(householdId);

  const favorites = [...recipesById.values()]
    .filter((recipe) => recipe.isFavorite)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Text variant="title" style={{ flex: 1 }}>
          Historique
        </Text>
        <SettingsButton />
      </View>

      {error ? <ErrorState message={error.message} /> : null}

      {favorites.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="overline" tone="faint">
            FAVORIS
          </Text>
          {favorites.map((recipe) => (
            <FavoriteCard key={recipe.id} recipe={recipe} />
          ))}
        </View>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="overline" tone="faint">
          SEMAINES
        </Text>

        {isLoading ? (
          <LoadingState />
        ) : weeks.length === 0 ? (
          <EmptyState
            title="Aucune semaine enregistrée"
            description="Les semaines s’ajoutent ici au fil des générations."
          />
        ) : (
          weeks.map((week) => (
            <WeekCard key={week.id} week={week} recipesById={recipesById} />
          ))
        )}
      </View>
    </Screen>
  );
}

function SettingsButton() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Réglages du foyer"
      hitSlop={12}
      onPress={() => router.push('/reglages')}
    >
      <Ionicons name="settings-outline" size={24} color={theme.colors.inkSoft} />
    </Pressable>
  );
}

function FavoriteCard({ recipe }: { recipe: Recipe }) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Card onPress={() => router.push(`/recette/${recipe.id}`)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="heart" size={16} color={theme.colors.spice} />
        <Text variant="heading" style={{ flex: 1 }}>
          {recipe.name}
        </Text>
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

function WeekCard({
  week,
  recipesById,
}: {
  week: WeeklyPlan;
  recipesById: Map<string, Recipe>;
}) {
  const theme = useTheme();

  // Les recettes citées par le plan, dans l'ordre où elles y apparaissent.
  const names = week.recipeIds
    .map((recipeId) => recipesById.get(recipeId))
    .filter((recipe): recipe is Recipe => recipe !== undefined);

  return (
    <Card>
      <Text variant="heading">Semaine du {week.weekStart}</Text>
      <Text variant="caption" tone="faint">
        {names.length} recette{names.length > 1 ? 's' : ''}
        {week.model ? ` · ${week.model}` : ''}
      </Text>

      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xs }}>
        {names.map((recipe) => (
          <Link key={recipe.id} href={`/recette/${recipe.id}`} asChild>
            <Pressable accessibilityRole="link">
              <Text tone="accent">{recipe.name}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </Card>
  );
}
