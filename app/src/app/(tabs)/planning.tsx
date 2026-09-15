import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import {
  addDays,
  capitalize,
  formatWeekRange,
  getBatchSession,
  getCurrentWeekId,
  getDayNameForDate,
  isLastMealOfBatchDish,
  listSwapTargets,
  toIsoDate,
  type DayPlan,
  type GenerationLock,
  type MealSlot,
  type Recipe,
} from '@dimanche-batch/shared';
import { EmptyState, ErrorState, LoadingState, Screen, StaleNotice, Text } from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { MealCard } from '@/features/meal-plan/components/meal-card';
import {
  MealChoiceSheet,
  type MealChoiceTarget,
} from '@/features/meal-plan/components/meal-choice-sheet';
import { WeekSwitch, type WeekOffset } from '@/features/meal-plan/components/week-switch';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useGenerationProgress } from '@/features/meal-plan/api/use-generation-progress';
import { useRegenerateMeal } from '@/features/meal-plan/api/use-regenerate-meal';
import { useSetMeal } from '@/features/meal-plan/api/use-set-meal';
import { useSwapMeals } from '@/features/meal-plan/api/use-swap-meals';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useToggleDislike } from '@/features/recipes/api/use-recipe-verdict';
import { useTheme } from '@/theme';

/** Les 7 jours de la semaine, du samedi au vendredi. */
export default function PlanningScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const today = toIsoDate(new Date());

  // Le planning s'ouvre sur ce qu'on mange ; les semaines à préparer sont à un
  // geste, parce que c'est elles qu'on ajuste avant les courses.
  const { week } = useLocalSearchParams<{ week?: string }>();
  const [offset, setOffset] = useState<WeekOffset>(week === '1' ? 1 : 0);
  const weekId = addDays(getCurrentWeekId(), 7 * offset);

  const householdId = household?.id ?? null;
  const { plan, isLoading, isStale, error } = useWeeklyPlan(householdId, weekId);
  // Les restes possibles viennent du batch de la semaine d'avant celle affichée.
  const previous = useWeeklyPlan(householdId, addDays(weekId, -7));
  const { recipesById } = useRecipes(householdId);
  const regenerate = useRegenerateMeal();
  const choose = useSetMeal();
  const swap = useSwapMeals();
  const dislike = useToggleDislike();

  const [target, setTarget] = useState<MealChoiceTarget | null>(null);
  const progress = useGenerationProgress(householdId, weekId);
  const batchRecipes = plan ? getBatchSession(plan, recipesById).recipes : [];

  const isFreezable = (recipeId: string) =>
    recipesById.get(recipeId)?.tags.includes('congelable') ?? false;
  const swapTargets =
    plan && target
      ? listSwapTargets(plan, { date: target.date, slot: target.slot }, isFreezable)
          .map((recipeId) => recipesById.get(recipeId))
          .filter((recipe): recipe is Recipe => recipe !== undefined)
      : [];
  const previousLeftovers = (previous.plan?.batchRecipeIds ?? [])
    .map((recipeId) => recipesById.get(recipeId))
    .filter((recipe): recipe is Recipe => recipe !== undefined);

  function closeSheet() {
    setTarget(null);
  }

  const pendingSlot =
    regenerate.isPending || choose.isPending || swap.isPending
      ? (regenerate.variables ?? choose.variables ?? swap.variables)
      : undefined;

  const mutationError = regenerate.error ?? choose.error ?? swap.error;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="overline" tone="faint">
          {formatWeekRange(weekId).toUpperCase()}
        </Text>
        <Text variant="title">Planning</Text>
        <WeekSwitch value={offset} onChange={setOffset} />
      </View>

      {isStale && plan !== null ? <StaleNotice /> : null}
      {error ? <ErrorState message={error.message} /> : null}
      {mutationError ? <ErrorState message={mutationError.message} /> : null}
      {dislike.error ? (
        <ErrorState message="Le plat n’a pas pu être banni. Vérifie ta connexion." />
      ) : null}

      {isLoading ? (
        <LoadingState />
      ) : plan === null ? (
        <EmptyState
          title="Aucun plan pour cette semaine"
          description="Compose-la depuis l’accueil : le batch du dimanche nourrit ensuite toute la semaine."
        />
      ) : (
        plan.days.map((day, dayIndex) => (
          <DaySection
            key={day.date}
            day={day}
            isToday={day.date === today}
            recipesById={recipesById}
            pending={pendingSlot}
            progress={progress}
            onChoose={(slot) => {
              const meal = day[slot];
              const recipeId = meal.recipeId;
              setTarget({
                date: day.date,
                slot,
                dayIndex,
                currentRecipeId: recipeId,
                currentRecipeName: recipeId ? (recipesById.get(recipeId)?.name ?? null) : null,
                isCurrentDisliked: recipeId
                  ? (recipesById.get(recipeId)?.isDisliked ?? false)
                  : false,
                isBatchPortion:
                  meal.kind === 'batch-leftover' &&
                  recipeId !== null &&
                  plan.batchRecipeIds.includes(recipeId),
                isLastMealOfDish: isLastMealOfBatchDish(plan, day.date, slot),
              });
            }}
          />
        ))
      )}

      <MealChoiceSheet
        target={target}
        batchRecipes={batchRecipes}
        swapTargets={swapTargets}
        previousLeftovers={previousLeftovers}
        onClose={closeSheet}
        onSwap={(recipeId) => {
          if (householdId && target) {
            swap.mutate({ householdId, weekId, date: target.date, slot: target.slot, recipeId });
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
        onPreviousLeftover={(recipeId) => {
          if (householdId && target) {
            choose.mutate({
              householdId,
              weekId,
              date: target.date,
              slot: target.slot,
              meal: { choice: 'previous-leftover', recipeId },
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
        onDislike={(isDisliked) => {
          if (householdId && target?.currentRecipeId) {
            dislike.mutate({
              householdId,
              recipeId: target.currentRecipeId,
              isDisliked,
            });
            // La feuille reste ouverte : les façons de remplacer le plat sont
            // juste dessous, et c'est le moment où l'on y pense.
            setTarget({ ...target, isCurrentDisliked: isDisliked });
          }
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
  progress,
  onChoose,
}: {
  day: DayPlan;
  isToday: boolean;
  recipesById: Map<string, Recipe>;
  /** Créneau en cours d'enregistrement, s'il y en a un. */
  pending: { date: string; slot: MealSlot } | undefined;
  progress: GenerationLock | null;
  onChoose: (slot: MealSlot) => void;
}) {
  const theme = useTheme();

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
        progress={progress}
        onChangeMeal={() => onChoose('lunch')}
      />
      <MealCard
        label="Soir"
        meal={day.dinner}
        recipesById={recipesById}
        isRegenerating={isPending('dinner')}
        progress={progress}
        onChangeMeal={() => onChoose('dinner')}
      />
    </View>
  );
}

/** Le mois est porté par l’en-tête de la semaine : le quantième suffit ici. */
function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}
