import { useState } from 'react';
import { View } from 'react-native';
import {
  getBatchSession,
  getCurrentWeekId,
  getDayNameForDate,
  getUpcomingWeekId,
  getWeekDates,
  toIsoDate,
  type DayPlan,
  type MealSlot,
  type Recipe,
} from '@dimanche-batch/shared';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  StaleNotice,
  Text,
} from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { MealCard } from '@/features/meal-plan/components/meal-card';
import {
  MealChoiceSheet,
  type MealChoiceTarget,
} from '@/features/meal-plan/components/meal-choice-sheet';
import { WeekSwitch } from '@/features/meal-plan/components/week-switch';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useRegenerateMeal } from '@/features/meal-plan/api/use-regenerate-meal';
import { useSetMeal } from '@/features/meal-plan/api/use-set-meal';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useTheme } from '@/theme';

/** Les 7 jours de la semaine, du samedi au vendredi. */
export default function PlanningScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const today = toIsoDate(new Date());

  // Le planning s'ouvre sur ce qu'on mange ; la semaine à préparer est à un
  // geste, parce que c'est elle qu'on ajuste avant les courses.
  const [showingCurrent, setShowingCurrent] = useState(true);
  const weekId = showingCurrent ? getCurrentWeekId() : getUpcomingWeekId();

  const householdId = household?.id ?? null;
  const { plan, isLoading, isStale, error } = useWeeklyPlan(householdId, weekId);
  const { recipesById } = useRecipes(householdId);
  const regenerate = useRegenerateMeal();
  const choose = useSetMeal();

  const [target, setTarget] = useState<MealChoiceTarget | null>(null);
  const batchRecipes = plan ? getBatchSession(plan, recipesById).recipes : [];
  const dates = getWeekDates(weekId);

  function closeSheet() {
    setTarget(null);
  }

  const pendingSlot =
    regenerate.isPending || choose.isPending
      ? (regenerate.variables ?? choose.variables)
      : undefined;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="overline" tone="faint">
          DU {dates[0]} AU {dates[6]}
        </Text>
        <Text variant="title">Planning</Text>
        <WeekSwitch showingCurrent={showingCurrent} onChange={setShowingCurrent} />
      </View>

      {isStale && plan !== null ? <StaleNotice /> : null}
      {error ? <ErrorState message={error.message} /> : null}
      {regenerate.error ? <ErrorState message={regenerate.error.message} /> : null}
      {choose.error ? <ErrorState message={choose.error.message} /> : null}

      {isLoading ? (
        <LoadingState />
      ) : plan === null ? (
        <EmptyState
          title="Aucun plan pour cette semaine"
          description="Compose-la depuis l’accueil : le batch du dimanche nourrit ensuite toute la semaine."
        />
      ) : (
        plan.days.map((day) => (
          <DaySection
            key={day.date}
            day={day}
            isToday={day.date === today}
            recipesById={recipesById}
            pending={pendingSlot}
            onChoose={(slot, currentRecipeName) =>
              setTarget({ date: day.date, slot, currentRecipeName })
            }
          />
        ))
      )}

      <MealChoiceSheet
        target={target}
        batchRecipes={batchRecipes}
        onClose={closeSheet}
        onCook={(style) => {
          if (householdId && target) {
            regenerate.mutate({
              householdId,
              weekId,
              date: target.date,
              slot: target.slot,
              style,
            });
          }
          closeSheet();
        }}
        onServeBatch={(recipeId) => {
          if (householdId && target) {
            choose.mutate({
              householdId,
              weekId,
              date: target.date,
              slot: target.slot,
              meal: { choice: 'batch', recipeId },
            });
          }
          closeSheet();
        }}
        onEatOut={() => {
          if (householdId && target) {
            choose.mutate({
              householdId,
              weekId,
              date: target.date,
              slot: target.slot,
              meal: { choice: 'eat-out' },
            });
          }
          closeSheet();
        }}
      />
    </Screen>
  );
}

function DaySection({
  day,
  isToday,
  recipesById,
  pending,
  onChoose,
}: {
  day: DayPlan;
  isToday: boolean;
  recipesById: Map<string, Recipe>;
  /** Créneau en cours d'enregistrement, s'il y en a un. */
  pending: { date: string; slot: MealSlot } | undefined;
  onChoose: (slot: MealSlot, currentRecipeName: string | null) => void;
}) {
  const theme = useTheme();

  const nameOf = (recipeId: string | null) =>
    recipeId ? (recipesById.get(recipeId)?.name ?? null) : null;

  const isPending = (slot: MealSlot) => pending?.date === day.date && pending.slot === slot;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
        <Text variant="heading" style={{ color: isToday ? theme.colors.accent : theme.colors.ink }}>
          {capitalize(getDayNameForDate(day.date))} {dayOfMonth(day.date)}
        </Text>
        {isToday ? (
          <Text variant="overline" style={{ color: theme.colors.accent }}>
            AUJOURD’HUI
          </Text>
        ) : null}
      </View>

      <MealCard
        label="Midi"
        meal={day.lunch}
        recipesById={recipesById}
        isRegenerating={isPending('lunch')}
        onChangeMeal={() => onChoose('lunch', nameOf(day.lunch.recipeId))}
      />
      <MealCard
        label="Soir"
        meal={day.dinner}
        recipesById={recipesById}
        isRegenerating={isPending('dinner')}
        onChangeMeal={() => onChoose('dinner', nameOf(day.dinner.recipeId))}
      />
    </View>
  );
}

/** Le mois est porté par l’en-tête de la semaine : le quantième suffit ici. */
function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
