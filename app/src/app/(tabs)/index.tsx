import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import {
  countUndecidedWeekendMeals,
  formatWeekRange,
  getComposableWeekId,
  getCurrentWeekId,
  getDayNameForDate,
  getThawReminders,
  toIsoDate,
  type Recipe,
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
import { GenerationProgress } from '@/features/meal-plan/components/generation-progress';
import { MealCard } from '@/features/meal-plan/components/meal-card';
import { VegetarianCountPicker } from '@/features/meal-plan/components/vegetarian-count-picker';
import { useGeneratePlan } from '@/features/meal-plan/api/use-generate-plan';
import { useGenerationProgress } from '@/features/meal-plan/api/use-generation-progress';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useTheme } from '@/theme';

/** Écran d'accueil : ce qu'on mange aujourd'hui, et l'étape suivante du cycle. */
export default function TodayScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const today = toIsoDate(new Date());

  const currentWeekId = getCurrentWeekId();
  const nextWeekId = getComposableWeekId(today);

  const householdId = household?.id ?? null;
  const current = useWeeklyPlan(householdId, currentWeekId);
  const next = useWeeklyPlan(householdId, nextWeekId);
  const { recipesById } = useRecipes(householdId);

  const day = current.plan?.days.find((entry) => entry.date === today) ?? null;
  const toThaw = current.plan ? getThawReminders(current.plan, recipesById, today) : [];

  return (
    <Screen withTabBar>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          {getDayNameForDate(today).toUpperCase()}
        </Text>
        <Text variant="title">{household?.name ?? 'Foyer'}</Text>
      </View>

      {current.isStale && current.plan !== null ? <StaleNotice /> : null}
      {current.error ? <ErrorState message={current.error.message} /> : null}
      {/*
        L'écoute de la semaine prochaine peut échouer elle aussi — typiquement
        juste après la création du foyer. Sans ce message, elle meurt en
        silence et un plan généré ensuite n'apparaît jamais.
      */}
      {next.error ? (
        <ErrorState
          message={`La semaine prochaine n’a pas pu être chargée : ${next.error.message}`}
        />
      ) : null}

      {toThaw.length > 0 ? <ThawReminder recipes={toThaw} /> : null}

      {current.isLoading ? (
        <LoadingState />
      ) : day === null ? (
        <EmptyState
          title="Rien de prévu aujourd’hui"
          description="On ne compose pas une semaine déjà commencée : prépare la prochaine ci-dessous, le batch du dimanche la nourrira en entier."
        />
      ) : (
        <>
          <MealCard label="Midi" meal={day.lunch} recipesById={recipesById} />
          <MealCard label="Soir" meal={day.dinner} recipesById={recipesById} />
        </>
      )}

      <NextStep
        today={today}
        currentPlan={current.plan}
        nextWeekId={nextWeekId}
        nextPlan={next.plan}
        isLoading={current.isLoading || next.isLoading}
        householdId={householdId}
      />
    </Screen>
  );
}

/**
 * Ce qu'il faut sortir du congélateur ce soir.
 *
 * En tête d'écran, avant même le repas du jour : c'est la seule chose ici qui
 * ait une heure limite, et la manquer se paie le lendemain midi. L'écran de
 * préparation le disait déjà, mais le dimanche — trois jours trop tôt.
 */
function ThawReminder({ recipes }: { recipes: Recipe[] }) {
  const theme = useTheme();
  const plural = recipes.length > 1;

  return (
    <Card style={{ borderColor: theme.colors.spice, borderWidth: 1 }}>
      <Text variant="overline" style={{ color: theme.colors.spice }}>
        À SORTIR DU CONGÉLATEUR CE SOIR
      </Text>
      {recipes.map((recipe) => (
        <Text key={recipe.id} variant="bodyStrong">
          {recipe.name}
        </Text>
      ))}
      <Text variant="caption" tone="soft">
        {plural ? 'Ils se mangent' : 'Il se mange'} demain : une nuit au frigo suffit à
        {plural ? ' les' : ' le'} décongeler.
      </Text>
    </Card>
  );
}

/**
 * Étape suivante du cycle hebdomadaire, dans l'ordre du calendrier réel.
 *
 * 1. Le dimanche, cuisiner le batch de la semaine en cours.
 * 2. La semaine prochaine est composée mais son week-end reste à décider :
 *    le faire **avant** les courses du samedi, qui doivent en acheter les
 *    ingrédients.
 * 3. Composer la semaine prochaine si elle n'a pas de plan.
 * 4. Sinon, elle est prête.
 *
 * Jamais la semaine en cours : elle a commencé, un plan composé maintenant
 * arriverait après les courses et le batch qu'il devait organiser.
 */
function NextStep({
  today,
  currentPlan,
  nextWeekId,
  nextPlan,
  isLoading,
  householdId,
}: {
  today: string;
  currentPlan: WeeklyPlan | null;
  nextWeekId: string;
  nextPlan: WeeklyPlan | null;
  isLoading: boolean;
  householdId: string | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const generate = useGeneratePlan();
  const [batchRecipeCount, setBatchRecipeCount] = useState(4);
  const [vegetarianChoice, setVegetarianChoice] = useState(0);
  // Ramené au nombre de plats au rendu : baisser le nombre de plats ne doit
  // jamais laisser plus de végétariens que de plats.
  const vegetarianCount = Math.min(vegetarianChoice, batchRecipeCount);

  const progress = useGenerationProgress(householdId, nextWeekId);

  if (isLoading || !householdId) return null;

  const isSunday = getDayNameForDate(today) === 'dimanche';
  if (isSunday && currentPlan && currentPlan.batchRecipeIds.length > 0) {
    return (
      <Card style={{ gap: theme.spacing.md }}>
        <Text variant="heading">C’est le jour du batch</Text>
        <Text tone="soft">
          Les plats de la semaine se préparent aujourd’hui, en une seule session.
        </Text>
        <Button
          label="Préparer le batch"
          onPress={() => router.push(`/batch?week=${currentPlan.id}`)}
        />
      </Card>
    );
  }

  const undecided = nextPlan ? countUndecidedWeekendMeals(nextPlan) : 0;
  if (nextPlan && undecided > 0) {
    return (
      <Card style={{ gap: theme.spacing.md, borderColor: theme.colors.spice, borderWidth: 1 }}>
        <Text variant="heading">Décider le samedi et le dimanche</Text>
        <Text tone="soft">
          Le batch de la semaine {formatWeekRange(nextWeekId)} est prêt. Il reste {undecided} repas
          du week-end à décider : un reste, un repas dehors ou un plat cuisiné. Fais-le avant les
          courses du samedi — ce qu’ils demandent s’ajoute à la liste.
        </Text>
        <Button label="Décider le week-end" onPress={() => router.push('/planning?week=1')} />
        <Button
          label="Voir le batch du dimanche"
          variant="ghost"
          onPress={() => router.push(`/batch?week=${nextWeekId}`)}
        />
      </Card>
    );
  }

  if (!nextPlan) {
    return (
      <Card style={{ gap: theme.spacing.lg }}>
        <Text variant="heading">Composer la semaine {formatWeekRange(nextWeekId)}</Text>
        <Text tone="soft">
          Choisis le nombre de plats et combien sont végétariens : le batch du dimanche nourrit
          ensuite les dix repas du lundi au vendredi. Le samedi et le dimanche se décident après.
        </Text>

        <BatchCountPicker value={batchRecipeCount} onChange={setBatchRecipeCount} />
        <VegetarianCountPicker
          value={vegetarianCount}
          batchRecipeCount={batchRecipeCount}
          onChange={setVegetarianChoice}
        />

        {generate.error ? <Text tone="danger">{generate.error.message}</Text> : null}

        {generate.isPending ? (
          <GenerationProgress lock={progress} />
        ) : (
          <Button
            label="Composer la semaine"
            onPress={() => {
              generate.mutate({
                householdId,
                weekStart: nextWeekId,
                batchRecipeCount,
                vegetarianCount,
              });
            }}
          />
        )}
      </Card>
    );
  }

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text variant="heading">La semaine prochaine est prête</Text>
      <Text tone="soft">Il reste à faire les courses, puis à cuisiner dimanche.</Text>
      <Button
        label="Voir le batch du dimanche"
        variant="secondary"
        onPress={() => router.push(`/batch?week=${nextWeekId}`)}
      />
    </Card>
  );
}
