import { Alert, View } from 'react-native';
import {
  getDayNameForDate,
  getCurrentWeekId,
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
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useRegenerateMeal } from '@/features/meal-plan/api/use-regenerate-meal';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useTheme } from '@/theme';

/** Les 7 jours de la semaine planifiée, midi et soir, avec régénération. */
export default function PlanningScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const today = toIsoDate(new Date());
  const weekId = getCurrentWeekId();

  const householdId = household?.id ?? null;
  const { plan, isLoading, isStale, error } = useWeeklyPlan(householdId, weekId);
  const { recipesById } = useRecipes(householdId);
  const regenerate = useRegenerateMeal();

  function askRegenerate(date: string, slot: MealSlot, currentName: string | null) {
    if (!householdId) return;

    Alert.alert(
      'Changer ce repas ?',
      currentName
        ? `« ${currentName} » sera remplacé par une nouvelle proposition, et la liste de courses recalculée.`
        : 'Une nouvelle recette sera proposée, et la liste de courses recalculée.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Changer',
          onPress: () => regenerate.mutate({ householdId, weekId, date, slot }),
        },
      ],
    );
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          SEMAINE DU {weekId}
        </Text>
        <Text variant="title">Planning</Text>
      </View>

      {isStale && plan !== null ? <StaleNotice /> : null}
      {error ? <ErrorState message={error.message} /> : null}
      {regenerate.error ? <ErrorState message={regenerate.error.message} /> : null}

      {isLoading ? (
        <LoadingState />
      ) : plan === null ? (
        <EmptyState
          title="Aucun plan pour cette semaine"
          description="Lance la génération depuis l’accueil : elle compose les sept jours d’un coup."
        />
      ) : (
        plan.days.map((day) => (
          <DaySection
            key={day.date}
            day={day}
            isToday={day.date === today}
            recipesById={recipesById}
            pending={regenerate.isPending ? regenerate.variables : undefined}
            onRegenerate={askRegenerate}
          />
        ))
      )}
    </Screen>
  );
}

function DaySection({
  day,
  isToday,
  recipesById,
  pending,
  onRegenerate,
}: {
  day: DayPlan;
  isToday: boolean;
  recipesById: Map<string, Recipe>;
  /** Créneau en cours de régénération, s’il y en a un. */
  pending: { date: string; slot: MealSlot } | undefined;
  onRegenerate: (date: string, slot: MealSlot, currentName: string | null) => void;
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
        onRegenerate={() => onRegenerate(day.date, 'lunch', nameOf(day.lunch.recipeId))}
      />
      <MealCard
        label="Soir"
        meal={day.dinner}
        recipesById={recipesById}
        isRegenerating={isPending('dinner')}
        onRegenerate={() => onRegenerate(day.date, 'dinner', nameOf(day.dinner.recipeId))}
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
