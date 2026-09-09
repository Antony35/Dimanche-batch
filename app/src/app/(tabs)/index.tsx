import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import {
  getCurrentWeekId,
  getDayNameForDate,
  getUpcomingWeekId,
  toIsoDate,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
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
import { BatchCountPicker } from '@/features/meal-plan/components/batch-count-picker';
import { MealCard } from '@/features/meal-plan/components/meal-card';
import { useGeneratePlan } from '@/features/meal-plan/api/use-generate-plan';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useTheme } from '@/theme';

/** Écran d'accueil : ce qu'on mange aujourd'hui, et l'étape suivante du cycle. */
export default function TodayScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const today = toIsoDate(new Date());

  const currentWeekId = getCurrentWeekId();
  const upcomingWeekId = getUpcomingWeekId();

  const householdId = household?.id ?? null;
  const current = useWeeklyPlan(householdId, currentWeekId);
  const upcoming = useWeeklyPlan(householdId, upcomingWeekId);
  const { recipesById } = useRecipes(householdId);

  const day = current.plan?.days.find((entry) => entry.date === today) ?? null;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          {getDayNameForDate(today).toUpperCase()}
        </Text>
        <Text variant="title">{household?.name ?? 'Foyer'}</Text>
      </View>

      {current.isStale && current.plan !== null ? <StaleNotice /> : null}
      {current.error ? <ErrorState message={current.error.message} /> : null}

      {current.isLoading ? (
        <LoadingState />
      ) : day === null ? (
        <EmptyState
          title="Rien de prévu aujourd’hui"
          description="Compose la semaine ci-dessous : le batch du dimanche la nourrit ensuite en entier."
        />
      ) : (
        <>
          <MealCard label="Midi" meal={day.lunch} recipesById={recipesById} />
          <MealCard label="Soir" meal={day.dinner} recipesById={recipesById} />
        </>
      )}

      <NextStep
        currentWeekId={currentWeekId}
        upcomingWeekId={upcomingWeekId}
        currentPlan={current.plan}
        upcomingPlan={upcoming.plan}
        isLoading={current.isLoading || upcoming.isLoading}
        householdId={householdId}
      />
    </Screen>
  );
}

/**
 * Étape suivante du cycle hebdomadaire.
 *
 * L'ordre des cas suit le calendrier réel : on rattrape d'abord une semaine en
 * cours restée vide — typiquement un samedi matin où l'on a oublié la veille —
 * puis on compose la suivante, puis on cuisine.
 */
function NextStep({
  currentWeekId,
  upcomingWeekId,
  currentPlan,
  upcomingPlan,
  isLoading,
  householdId,
}: {
  currentWeekId: string;
  upcomingWeekId: string;
  currentPlan: WeeklyPlan | null;
  upcomingPlan: WeeklyPlan | null;
  isLoading: boolean;
  householdId: string | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const generate = useGeneratePlan();
  const [batchRecipeCount, setBatchRecipeCount] = useState(4);

  if (isLoading || !householdId) return null;

  const missingWeekId =
    currentPlan === null ? currentWeekId : upcomingPlan === null ? upcomingWeekId : null;

  if (missingWeekId !== null) {
    const isCatchUp = missingWeekId === currentWeekId;

    return (
      <Card style={{ gap: theme.spacing.lg }}>
        <Text variant="heading">
          {isCatchUp ? 'Composer cette semaine' : 'Composer la semaine prochaine'}
        </Text>
        <Text tone="soft">
          {isCatchUp
            ? 'Cette semaine n’a pas encore de plan. La composer maintenant donne la liste de courses à faire au plus vite.'
            : 'Compose-la avant le week-end : les courses se font le samedi, le batch le dimanche.'}
        </Text>
        <Text variant="caption" tone="faint">
          Semaine du {missingWeekId}
        </Text>

        <BatchCountPicker value={batchRecipeCount} onChange={setBatchRecipeCount} />

        {generate.error ? <Text tone="danger">{generate.error.message}</Text> : null}
        <Button
          label={generate.isPending ? 'Composition en cours…' : 'Composer la semaine'}
          loading={generate.isPending}
          onPress={() => {
            generate.mutate({ householdId, weekStart: missingWeekId, batchRecipeCount });
          }}
        />
      </Card>
    );
  }

  const isSunday = new Date().getDay() === 0;

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text variant="heading">
        {isSunday ? 'C’est le jour du batch' : 'La semaine prochaine est prête'}
      </Text>
      <Text tone="soft">
        {isSunday
          ? 'Les plats de la semaine se préparent aujourd’hui, en une seule session.'
          : 'Il reste à faire les courses, puis à cuisiner dimanche.'}
      </Text>
      <Button
        label={isSunday ? 'Préparer le batch' : 'Voir le batch du dimanche'}
        variant={isSunday ? 'primary' : 'secondary'}
        onPress={() => router.push(`/batch?week=${upcomingWeekId}`)}
      />
    </Card>
  );
}
