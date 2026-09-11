import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import {
  capitalize,
  formatQuantity,
  getSharedIngredients,
  ingredientsForStep,
  isScheduleCurrent,
  type GenerationLock,
  type Recipe,
  type SharedIngredient,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import { Button, Card, ErrorState, LoadingState, Text } from '@/components/ui';
import type { BatchProgressState } from '@/features/meal-plan/api/use-batch-progress';
import type { BatchScheduleState } from '@/features/meal-plan/api/use-batch-schedule';
import { GenerationProgress } from '@/features/meal-plan/components/generation-progress';
import { useTheme } from '@/theme';

export interface BatchScheduleViewProps {
  plan: WeeklyPlan;
  recipesById: Map<string, Recipe>;
  schedule: BatchScheduleState;
  progress: BatchProgressState;
  isComposing: boolean;
  composeError: Error | null;
  generation: GenerationLock | null;
  onCompose: () => void;
}

/**
 * Le dimanche en une seule séquence : les étapes des plats fondues, chacune
 * rattachée aux plats qu'elle concerne.
 *
 * Généré à la demande puis conservé. Tant qu'il n'existe pas — ou qu'il décrit
 * un batch qui a changé depuis — la vue dit ce que coûte le composer avant le
 * geste, plutôt que de le lancer d'office en ouvrant l'onglet.
 */
export function BatchScheduleView({
  plan,
  recipesById,
  schedule,
  progress,
  isComposing,
  composeError,
  generation,
  onCompose,
}: BatchScheduleViewProps) {
  const theme = useTheme();

  if (schedule.isLoading) return <LoadingState />;

  const current = schedule.schedule;
  const isStale = current !== null && !isScheduleCurrent(current, plan);

  if (current === null || isStale) {
    return (
      <Card style={{ gap: theme.spacing.md }}>
        <Text variant="heading">Tout en parallèle</Text>
        <Text tone="soft">
          {isStale
            ? 'Le batch a changé depuis le dernier déroulé : il décrit des plats qui ne sont plus au menu.'
            : 'Les étapes des plats fondues en une seule séquence : les gestes semblables regroupés, les cuissons longues lancées tôt.'}
        </Text>
        {composeError ? <ErrorState message={composeError.message} /> : null}
        {schedule.error ? <ErrorState message={schedule.error.message} /> : null}
        {isComposing ? (
          <GenerationProgress lock={generation} />
        ) : (
          <Button
            label={isStale ? 'Recomposer le déroulé' : 'Composer le déroulé'}
            onPress={onCompose}
          />
        )}
        <Text variant="caption" tone="faint">
          Consomme une génération, une seule fois : le déroulé est ensuite conservé, et l’autre
          téléphone le voit aussi.
        </Text>
      </Card>
    );
  }

  // Une clé par version du déroulé. Les slugs ne contiennent jamais de `_`,
  // donc aucune collision possible avec l'avancement d'un plat — et un déroulé
  // recomposé repart de zéro au lieu d'hériter des cases de l'ancien.
  // Le partage se calcule depuis les recettes, pas depuis le déroulé : il vaut
  // pour tout déroulé, y compris ceux composés avant cette fonctionnalité.
  const batchRecipes = plan.batchRecipeIds
    .map((id) => recipesById.get(id))
    .filter((recipe): recipe is Recipe => recipe !== undefined);
  const shared = getSharedIngredients(batchRecipes);
  const dishName = (id: string) => recipesById.get(id)?.name ?? id;

  const progressKey = `__deroule:${current.generatedAt}`;
  const stepCount = current.steps.length;
  const done = progress.checkedCount(progressKey, stepCount);

  return (
    <>
      {shared.length > 0 ? (
        <Card style={{ gap: theme.spacing.xs }}>
          <Text variant="overline" tone="faint">
            MISE EN PLACE
          </Text>
          <Text variant="caption" tone="faint">
            Ce qui se coupe pour plusieurs plats, et la part de chacun.
          </Text>
          {shared.map((ingredient) => (
            <Text key={`${ingredient.name}-${ingredient.total.unit}`}>
              <Text variant="bodyStrong">{capitalize(ingredient.name)}</Text>{' '}
              {describeShares(ingredient, dishName)}
            </Text>
          ))}
        </Card>
      ) : null}
      <Card style={{ gap: theme.spacing.sm }}>
        <Text variant="overline" tone="faint">
          DÉROULÉ {done > 0 ? `· ${done}/${stepCount}` : `· ${stepCount} ÉTAPES`}
        </Text>
        {current.steps.map((step, index) => {
          const isChecked = progress.isChecked(progressKey, index, stepCount);
          const dishes = step.recipeIds.map((id) => recipesById.get(id)?.name ?? id).join(' · ');
          return (
            <Pressable
              key={`${progressKey}-${index}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              accessibilityLabel={`Étape ${index + 1}, ${dishes} : ${step.text}`}
              onPress={() => progress.toggleStep(progressKey, index, stepCount)}
              hitSlop={6}
              style={{ flexDirection: 'row', gap: theme.spacing.md, paddingVertical: 4 }}
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
              <View style={{ flex: 1, gap: 2 }}>
                {/* Le plat d'abord : c'est ce qui permet de s'y retrouver. */}
                <Text variant="caption" style={{ color: theme.colors.spice }}>
                  {dishes}
                </Text>
                <Text
                  style={{
                    textDecorationLine: isChecked ? 'line-through' : 'none',
                    color: isChecked ? theme.colors.inkFaint : theme.colors.ink,
                  }}
                >
                  {step.text}
                </Text>
                {ingredientsForStep(step, shared).map((ingredient) => (
                  <Text
                    key={`${ingredient.name}-${ingredient.total.unit}`}
                    variant="caption"
                    tone="soft"
                  >
                    └ {capitalize(ingredient.name)} {describeShares(ingredient, dishName)}
                  </Text>
                ))}
              </View>
            </Pressable>
          );
        })}
      </Card>
    </>
  );
}

/** « 5 → 2 Curry · 3 Chili » : le total d'abord, puisqu'on coupe tout d'un coup. */
function describeShares(ingredient: SharedIngredient, dishName: (id: string) => string): string {
  const parts = ingredient.shares.map(
    (share) => `${formatQuantity(share.qty, share.unit)} ${dishName(share.recipeId)}`,
  );
  return `${formatQuantity(ingredient.total.qty, ingredient.total.unit)} → ${parts.join(' · ')}`;
}
