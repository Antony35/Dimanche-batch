import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import {
  isScheduleCurrent,
  type GenerationLock,
  type Recipe,
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
  const progressKey = `__deroule:${current.generatedAt}`;
  const stepCount = current.steps.length;
  const done = progress.checkedCount(progressKey, stepCount);

  return (
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
            </View>
          </Pressable>
        );
      })}
    </Card>
  );
}
