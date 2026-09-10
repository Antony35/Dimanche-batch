import { useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { Pressable, View } from 'react-native';
import {
  AISLE_LABELS,
  formatQuantity,
  countMealsServing,
  getBatchSession,
  getDayName,
  getUpcomingWeekId,
  capitalize,
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
  Tag,
  Text,
} from '@/components/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useHousehold } from '@/features/household/api/use-household';
import {
  useBatchProgress,
  type BatchProgressState,
} from '@/features/meal-plan/api/use-batch-progress';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useReplaceBatchRecipe } from '@/features/meal-plan/api/use-replace-batch-recipe';
import { GenerationProgress } from '@/features/meal-plan/components/generation-progress';
import { useGenerationProgress } from '@/features/meal-plan/api/use-generation-progress';
import { useWeeklyPlan } from '@/features/meal-plan/api/use-weekly-plan';
import { useTheme } from '@/theme';

/**
 * Session de préparation du dimanche.
 *
 * Les recettes sont présentées à la suite, dans l'ordre où le modèle a demandé
 * de les cuisiner. Pas d'entrelacement des étapes : mélanger les gestes de
 * quatre plats produit une liste qu'on ne peut plus rattacher à un plat quand
 * on s'y perd.
 */
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
  const generation = useGenerationProgress(householdId, weekId);

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

  if (session.recipes.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="Pas de batch pour cette semaine"
          description="Cette semaine a été composée avant l’arrivée du batch. Régénère-la pour obtenir la session du dimanche."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          {getDayName(1).toUpperCase()} {session.cookDate}
        </Text>
        <Text variant="title">Préparation du batch</Text>
        <Text tone="soft">
          {session.recipes.length} plats · environ {formatDuration(session.totalMinutes)} de
          cuisine, à enchaîner dans cet ordre.
        </Text>
      </View>

      {replace.error ? <ErrorState message={replace.error.message} /> : null}

      {session.recipes.map((entry, index) => (
        <BatchRecipeCard
          key={entry.recipe.id}
          entry={entry}
          position={index + 1}
          progress={progress}
          mealCount={countMealsServing(plan, entry.recipe.id)}
          isReplacing={replace.isPending && replace.variables?.recipeId === entry.recipe.id}
          generation={generation}
          onReplace={() => {
            if (householdId) {
              replace.mutate({ householdId, weekId, recipeId: entry.recipe.id });
            }
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
}: {
  entry: BatchRecipe;
  position: number;
  progress: BatchProgressState;
  /** Repas que ce plat sert : ce qu'un remplacement mettrait à jour d'un coup. */
  mealCount: number;
  isReplacing: boolean;
  generation: GenerationLock | null;
  onReplace: () => void;
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
          {recipe.prepMinutes} min · {recipe.servings} portions ·{' '}
          {describeServedDays(entry.servedDayIndexes)}
        </Text>

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
        {recipe.ingredients.map((ingredient, index) => (
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

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}
