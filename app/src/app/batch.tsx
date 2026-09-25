import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { Pressable, View } from 'react-native';
import {
  AISLE_LABELS,
  formatDateLong,
  formatDuration,
  formatQuantity,
  countBatchMealsServing,
  getBatchSession,
  getDayName,
  getUpcomingWeekId,
  isBatchDayPast,
  capitalize,
  scaleIngredients,
  toIsoDate,
  type BatchRecipe,
  type GenerationLock,
} from '@dimanche-batch/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  SegmentedSwitch,
  Tag,
  Text,
} from '@/components/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useHousehold } from '@/features/household/api/use-household';
import {
  useBatchProgress,
  type BatchProgressState,
} from '@/features/meal-plan/api/use-batch-progress';
import { useCookingSession } from '@/features/meal-plan/api/use-cooking-session';
import { useComposeCookingSession } from '@/features/meal-plan/api/use-compose-cooking-session';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useRemoveBatchRecipe } from '@/features/meal-plan/api/use-remove-batch-recipe';
import { useReplaceBatchRecipe } from '@/features/meal-plan/api/use-replace-batch-recipe';
import { BatchSessionView } from '@/features/meal-plan/components/batch-session-view';
import { confirmBatchRemoval } from '@/features/meal-plan/components/confirm-batch-removal';
import { GenerationProgress } from '@/features/meal-plan/components/generation-progress';
import { useGenerationProgress } from '@/features/meal-plan/api/use-generation-progress';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useTheme } from '@/theme';

/**
 * Session de préparation du dimanche, sous deux formes.
 *
 * « Recette par recette » enchaîne les plats tels qu'ils sont écrits.
 * « Mise en place puis cuisson » coupe tout d'un coup, puis cuisine les plats
 * du plus long au plus court, avec des étapes réécrites sans la découpe.
 */
type BatchView = 'recipes' | 'session';

const VIEW_OPTIONS = [
  { value: 'recipes', label: 'Recette par recette' },
  { value: 'session', label: 'Mise en place puis cuisson' },
] as const;

/** Ce que promet chaque vue, sous le sélecteur. */
const VIEW_HINTS: Record<BatchView, string> = {
  recipes: 'Un plat après l’autre, dans l’ordre prévu : plus lent, plus tranquille.',
  session:
    'Tout couper d’un coup, puis cuisiner les plats du plus long au plus court : chaque fiche ne garde que la cuisson.',
};

export default function BatchScreen() {
  const theme = useTheme();
  // Trois heures de cuisine, les mains prises : l'écran ne doit pas s'éteindre
  // toutes les trente secondes. Actif sur ce seul écran, et rendu à Android dès
  // qu'on en sort.
  useKeepAwake();
  const { week } = useLocalSearchParams<{ week?: string }>();
  const { household } = useHousehold();

  const weekId = week ?? getUpcomingWeekId();
  const householdId = household?.id ?? null;
  const { plan, isLoading, error } = useWeeklyPlan(householdId, weekId);
  const { recipesById } = useRecipes(householdId);
  const progress = useBatchProgress(householdId, weekId);
  const replace = useReplaceBatchRecipe();
  const remove = useRemoveBatchRecipe();
  const generation = useGenerationProgress(householdId, weekId);
  const cookingSession = useCookingSession(householdId, weekId);
  const composeSession = useComposeCookingSession();
  // La vue par recette reste la vue par défaut : selon les plats et le temps
  // disponible, enchaîner tranquillement reste un choix valable.
  const [view, setView] = useState<BatchView>('recipes');

  if (isLoading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (!plan) {
    return (
      <Screen>
        {error ? <ErrorState message={error.message} /> : null}
        <EmptyState
          title="Aucun plan pour cette semaine"
          description="Compose la semaine depuis l’accueil : le batch en découle."
        />
      </Screen>
    );
  }

  const session = getBatchSession(plan, recipesById);
  // Une fois le batch cuisiné, le plat est au frigo : on ne le retire plus.
  const canRemove = !isBatchDayPast(plan.weekStart, toIsoDate(new Date()));

  if (session.recipes.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="Rien à cuisiner dimanche"
          description="Aucun plat au batch cette semaine : les repas se décident dans le planning, avec les restes du frigo."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          {formatDateLong(session.cookDate).toUpperCase()}
        </Text>
        <Text variant="title">Préparation du batch</Text>
        <Text tone="soft">
          {session.recipes.length} plats · environ {formatDuration(session.totalMinutes)} de
          présence en cuisine. Commence par les plats qui cuisent seuls.
        </Text>
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        <SegmentedSwitch options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Text variant="caption" tone="faint">
          {VIEW_HINTS[view]}
        </Text>
      </View>

      {replace.error ? <ErrorState message={replace.error.message} /> : null}
      {remove.error ? <ErrorState message={remove.error.message} /> : null}

      {view === 'session' ? (
        <BatchSessionView
          plan={plan}
          recipesById={recipesById}
          cookingSession={cookingSession}
          progress={progress}
          isComposing={composeSession.isPending}
          composeError={composeSession.error}
          generation={generation}
          onCompose={() => {
            if (householdId) composeSession.mutate({ householdId, weekId });
          }}
        />
      ) : null}

      {view === 'recipes' &&
        session.recipes.map((entry, index) => (
          <BatchRecipeCard
            key={entry.recipe.id}
            entry={entry}
            position={index + 1}
            progress={progress}
            mealCount={countBatchMealsServing(plan, entry.recipe.id)}
            isReplacing={replace.isPending && replace.variables?.recipeId === entry.recipe.id}
            generation={generation}
            onReplace={() => {
              if (householdId) {
                replace.mutate({ householdId, weekId, recipeId: entry.recipe.id });
              }
            }}
            canRemove={canRemove}
            isRemoving={remove.isPending && remove.variables?.recipeId === entry.recipe.id}
            onRemove={() => {
              const mealCount = countBatchMealsServing(plan, entry.recipe.id);
              confirmBatchRemoval(entry.recipe.name, mealCount, () => {
                if (householdId) {
                  remove.mutate({ householdId, weekId, recipeId: entry.recipe.id });
                }
              });
            }}
          />
        ))}
    </Screen>
  );
}

function BatchRecipeCard({
  entry,
  position,
  progress,
  mealCount,
  isReplacing,
  generation,
  onReplace,
  canRemove,
  isRemoving,
  onRemove,
}: {
  entry: BatchRecipe;
  position: number;
  progress: BatchProgressState;
  /** Repas que ce plat sert : ce qu'un remplacement mettrait à jour d'un coup. */
  mealCount: number;
  isReplacing: boolean;
  generation: GenerationLock | null;
  onReplace: () => void;
  canRemove: boolean;
  isRemoving: boolean;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const { recipe } = entry;
  const stepCount = recipe.steps.length;
  const done = progress.checkedCount(recipe.id, stepCount);

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <View style={{ gap: theme.spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
          <Text variant="overline" tone="faint">
            {position}
          </Text>
          <Text variant="heading" style={{ flex: 1 }}>
            {recipe.name}
          </Text>
        </View>

        <Text variant="caption" tone="soft">
          {recipe.prepMinutes} min
          {recipe.cookMinutes > 0 ? ` + ${recipe.cookMinutes} min de cuisson seule` : ''} ·{' '}
          <Text variant="caption" style={{ color: theme.colors.accent }}>
            {entry.portions} portions à cuisiner
          </Text>{' '}
          · {describeServedDays(entry.servedDayIndexes)}
        </Text>

        {entry.portions !== recipe.servings ? (
          <Text variant="caption" tone="faint">
            La recette est prévue pour {recipe.servings} portions : les quantités ci-dessous sont
            celles de la liste de courses, pour {entry.portions}.
          </Text>
        ) : null}

        {entry.needsFreezing ? (
          <Text variant="caption" style={{ color: theme.colors.spice }}>
            À congeler en portions. L’accueil rappellera de le sortir la veille du jour où on le
            mange.
          </Text>
        ) : null}

        {recipe.tags.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {recipe.tags.map((tag) => (
              <Tag key={tag} tag={tag} />
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          INGRÉDIENTS
        </Text>
        {scaleIngredients(recipe, entry.portions).map((ingredient, index) => (
          <View
            key={`${ingredient.name}-${index}`}
            style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}
          >
            <Text style={{ flex: 1 }}>{capitalize(ingredient.name)}</Text>
            <Text variant="caption" tone="faint">
              {AISLE_LABELS[ingredient.aisle]}
            </Text>
            <Text variant="bodyStrong">{formatQuantity(ingredient.qty, ingredient.unit)}</Text>
          </View>
        ))}
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          ÉTAPES {done > 0 ? `· ${done}/${stepCount}` : ''}
        </Text>
        {/*
          La clé porte l'index et non le texte : deux étapes identiques dans une
          même recette (« Réserver. ») entreraient sinon en collision, ce qui se
          voit dès qu'on coche.
        */}
        {recipe.steps.map((step, index) => {
          const isChecked = progress.isChecked(recipe.id, index, stepCount);
          return (
            <Pressable
              key={`${recipe.id}-${index}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              accessibilityLabel={`Étape ${index + 1} : ${step}`}
              onPress={() => progress.toggleStep(recipe.id, index, stepCount)}
              hitSlop={6}
              style={{ flexDirection: 'row', gap: theme.spacing.md, paddingVertical: 2 }}
            >
              {isChecked ? (
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={theme.colors.accent}
                  style={{ minWidth: 20 }}
                />
              ) : (
                <Text variant="bodyStrong" tone="accent" style={{ minWidth: 20 }}>
                  {index + 1}
                </Text>
              )}
              <Text
                style={{
                  flex: 1,
                  textDecorationLine: isChecked ? 'line-through' : 'none',
                  color: isChecked ? theme.colors.inkFaint : theme.colors.ink,
                }}
              >
                {step}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        {isReplacing ? (
          <GenerationProgress lock={generation} />
        ) : (
          <Button label="Remplacer ce plat" variant="ghost" onPress={onReplace} />
        )}
        <Text variant="caption" tone="faint">
          Remplace les {mealCount} repas qu’il sert, d’un coup. Consomme une génération, et met à
          jour la liste de courses — les articles déjà cochés que les deux plats partagent gardent
          leur case, avec une quantité qui change.
        </Text>
        {canRemove ? (
          <>
            <Button
              label="Retirer ce plat du batch"
              variant="ghost"
              loading={isRemoving}
              onPress={onRemove}
            />
            <Text variant="caption" tone="faint">
              Le frigo est déjà plein ? Le plat n’est ni cuisiné ni acheté, et ses {mealCount} repas
              passent à décider. Rien n’est consommé.
            </Text>
          </>
        ) : null}
      </View>
    </Card>
  );
}

/** « lundi et mardi », plutôt qu'une liste d'index que personne ne lit. */
function describeServedDays(dayIndexes: number[]): string {
  const names = dayIndexes.map((index) => getDayName(index)).filter(Boolean);
  if (names.length === 0) return 'aucun repas prévu';
  if (names.length === 1) return `servi ${names[0]}`;

  const last = names[names.length - 1];
  return `servi ${names.slice(0, -1).join(', ')} et ${last}`;
}
