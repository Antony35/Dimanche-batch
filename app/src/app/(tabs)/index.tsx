import { View } from 'react-native';
import { getDayNameForDate, getCurrentWeekId, toIsoDate } from '@dimanche-batch/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  StaleNotice,
  Text,
} from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { MealCard } from '@/features/meal-plan/components/meal-card';
import { useGeneratePlan } from '@/features/meal-plan/api/use-generate-plan';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useTheme } from '@/theme';

/** Écran d'accueil : ce qu'on mange aujourd'hui, midi et soir. */
export default function TodayScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const today = toIsoDate(new Date());
  const weekId = getCurrentWeekId();

  const householdId = household?.id ?? null;
  const { plan, isLoading, isStale, error } = useWeeklyPlan(householdId, weekId);
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

      {isStale && plan !== null ? <StaleNotice /> : null}
      {error ? <ErrorState message={error.message} /> : null}

      {isLoading ? (
        <LoadingState />
      ) : plan === null ? (
        <NoPlanYet
          weekId={weekId}
          isGenerating={generate.isPending}
          error={generate.error}
          onGenerate={() => {
            if (householdId) {
              generate.mutate({ householdId, weekStart: weekId, batchRecipeCount: 4 });
            }
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
