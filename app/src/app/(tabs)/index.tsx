import { useRouter } from 'expo-router';
import { View } from 'react-native';
import {
  getDayNameForDate,
  getPlanningWeekId,
  toIsoDate,
  type Meal,
  type Recipe,
} from '@dimanche-batch/shared';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Tag, Text } from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { useGeneratePlan } from '@/features/meal-plan/api/use-generate-plan';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useTheme } from '@/theme';

/** Écran d'accueil : ce qu'on mange aujourd'hui, midi et soir. */
export default function TodayScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const today = toIsoDate(new Date());
  const weekId = getPlanningWeekId();

  const householdId = household?.id ?? null;
  const { plan, isLoading, error } = useWeeklyPlan(householdId, weekId);
  const { recipesById } = useRecipes(householdId);
  const generate = useGeneratePlan();

  const day = plan?.days.find((entry) => entry.date === today) ?? null;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          {getDayNameForDate(today).toUpperCase()}
        </Text>
        <Text variant="title">{household?.name ?? 'Foyer'}</Text>
      </View>

      {error ? <ErrorState message={error.message} /> : null}

      {isLoading ? (
        <LoadingState />
      ) : plan === null ? (
        <NoPlanYet
          weekId={weekId}
          isGenerating={generate.isPending}
          error={generate.error}
          onGenerate={() => {
            if (householdId) generate.mutate({ householdId, weekStart: weekId });
          }}
        />
      ) : day === null ? (
        <EmptyState
          title="Rien de prévu aujourd’hui"
          description={`Le plan couvre la semaine du ${plan.weekStart}.`}
        />
      ) : (
        <>
          <MealCard label="Midi" meal={day.lunch} recipesById={recipesById} />
          <MealCard label="Soir" meal={day.dinner} recipesById={recipesById} />
        </>
      )}
    </Screen>
  );
}

function NoPlanYet({
  weekId,
  isGenerating,
  error,
  onGenerate,
}: {
  weekId: string;
  isGenerating: boolean;
  error: Error | null;
  onGenerate: () => void;
}) {
  const theme = useTheme();

  return (
    <Card style={{ gap: theme.spacing.lg }}>
      <Text variant="heading">Aucun plan pour cette semaine</Text>
      <Text tone="soft">
        La génération compose sept jours de repas, puis la liste de courses correspondante. Elle
        prend une trentaine de secondes.
      </Text>
      <Text variant="caption" tone="faint">
        Semaine du {weekId}
      </Text>
      {error ? <Text tone="danger">{error.message}</Text> : null}
      <Button
        label={isGenerating ? 'Génération en cours…' : 'Générer la semaine'}
        onPress={onGenerate}
        loading={isGenerating}
      />
    </Card>
  );
}

const KIND_LABELS: Record<Meal['kind'], string | null> = {
  cooked: null,
  'batch-leftover': 'Reste du batch',
  'freezer-backup': 'Sorti du congélateur',
  'eat-out': 'Repas à l’extérieur',
};

function MealCard({
  label,
  meal,
  recipesById,
}: {
  label: string;
  meal: Meal;
  recipesById: Map<string, Recipe>;
}) {
  const theme = useTheme();
  const router = useRouter();
  const recipe = meal.recipeId ? recipesById.get(meal.recipeId) : undefined;
  const kindLabel = KIND_LABELS[meal.kind];

  return (
    <Card onPress={recipe ? () => router.push(`/recette/${recipe.id}`) : undefined}>
      <Text variant="overline" tone="faint">
        {label.toUpperCase()}
      </Text>
      <Text variant="heading">{recipe?.name ?? KIND_LABELS['eat-out']}</Text>

      {kindLabel ? (
        <Text variant="caption" tone="soft">
          {kindLabel}
        </Text>
      ) : recipe ? (
        <Text variant="caption" tone="soft">
          {recipe.prepMinutes} min · {recipe.servings} portions
        </Text>
      ) : null}

      {meal.withStarter || meal.withDessert ? (
        <Text variant="caption" tone="faint">
          {[meal.withStarter ? 'avec entrée' : null, meal.withDessert ? 'avec dessert' : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}

      {recipe && recipe.tags.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
          {recipe.tags.map((tag) => (
            <Tag key={tag} tag={tag} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}
