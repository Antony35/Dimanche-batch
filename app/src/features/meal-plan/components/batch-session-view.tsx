import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import {
  AISLE_LABELS,
  capitalize,
  formatQuantity,
  getBatchSession,
  getMiseEnPlace,
  isScheduleCurrent,
  orderForCooking,
  sessionCookMinutes,
  scaleIngredients,
  type BatchRecipe,
  type CookingSession,
  type GenerationLock,
  type MiseEnPlaceGroup,
  type MiseEnPlaceLine,
  type Recipe,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import { Button, Card, ErrorState, LoadingState, Text } from '@/components/ui';
import type { BatchProgressState } from '@/features/meal-plan/api/use-batch-progress';
import type { BatchScheduleState } from '@/features/meal-plan/api/use-batch-schedule';
import { GenerationProgress } from '@/features/meal-plan/components/generation-progress';
import { useTheme } from '@/theme';

export interface BatchSessionViewProps {
  plan: WeeklyPlan;
  recipesById: Map<string, Recipe>;
  schedule: BatchScheduleState;
  progress: BatchProgressState;
  isComposing: boolean;
  composeError: Error | null;
  generation: GenerationLock | null;
  onCompose: () => void;
}

const GROUP_LABELS: Record<MiseEnPlaceGroup, string> = {
  aromates: 'AROMATES',
  legumes: 'LÉGUMES',
  viande: 'VIANDE',
  poisson: 'POISSON',
};

/**
 * Le dimanche en deux temps : tout couper d'un coup, puis cuisiner les plats
 * l'un après l'autre, du plus long au plus court.
 *
 * La mise en place se calcule et s'affiche tout de suite. Les découpes et les
 * étapes de cuisson demandent une génération, faite une fois puis conservée :
 * tant qu'elles n'existent pas — ou qu'elles décrivent un batch qui a changé —
 * la vue dit ce que coûte les composer avant le geste.
 */
export function BatchSessionView({
  plan,
  recipesById,
  schedule,
  progress,
  isComposing,
  composeError,
  generation,
  onCompose,
}: BatchSessionViewProps) {
  const theme = useTheme();

  if (schedule.isLoading) return <LoadingState />;

  const entries = getBatchSession(plan, recipesById).recipes;
  const stored = schedule.session;
  const isStale = stored !== null && !isScheduleCurrent(stored, plan);
  const session = stored !== null && !isStale ? stored : null;

  const lines = getMiseEnPlace(entries, session?.cuts ?? []);
  const dishName = (id: string) => recipesById.get(id)?.name ?? id;
  // Une clé par version de la session : une session recomposée repart de zéro
  // au lieu d'hériter des cases de l'ancienne. Les slugs ne contiennent jamais
  // de `_`, donc aucune collision avec l'avancement d'un plat.
  const version = session?.generatedAt ?? 'calcul';

  return (
    <>
      <MiseEnPlaceCard
        lines={lines}
        dishName={dishName}
        progress={progress}
        progressKey={`__mise:${version}`}
        hasCuts={session !== null}
      />

      {session === null ? (
        <Card style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Étapes de cuisson</Text>
          <Text tone="soft">
            {isStale
              ? 'Le batch a changé depuis : les étapes enregistrées décrivent des plats qui ne sont plus au menu.'
              : 'Une fois tout coupé, chaque plat n’a plus que sa cuisson. Les étapes sont réécrites sans la découpe, et la mise en place dira comment couper chaque ingrédient.'}
          </Text>
          {composeError ? <ErrorState message={composeError.message} /> : null}
          {schedule.error ? <ErrorState message={schedule.error.message} /> : null}
          {isComposing ? (
            <GenerationProgress lock={generation} />
          ) : (
            <Button
              label={isStale ? 'Recomposer les étapes' : 'Composer les étapes de cuisson'}
              onPress={onCompose}
            />
          )}
          <Text variant="caption" tone="faint">
            Consomme une génération, une seule fois : les étapes sont ensuite conservées, et l’autre
            téléphone les voit aussi.
          </Text>
        </Card>
      ) : (
        <>
          <Text variant="overline" tone="faint">
            CUISSON · DU PLUS LONG AU PLUS COURT
          </Text>
          {orderForCooking(
            // Le temps de la session, qui concorde avec les étapes affichées,
            // décide de l'ordre comme de ce que la fiche annonce.
            entries.map((entry) => ({
              ...entry,
              recipe: { ...entry.recipe, cookMinutes: sessionCookMinutes(session, entry.recipe) },
            })),
          ).map((entry, index, ordered) => (
            <CookingCard
              key={entry.recipe.id}
              entry={entry}
              position={index + 1}
              session={session}
              progress={progress}
              nextName={ordered[index + 1]?.recipe.name ?? null}
            />
          ))}
        </>
      )}
    </>
  );
}

function MiseEnPlaceCard({
  lines,
  dishName,
  progress,
  progressKey,
  hasCuts,
}: {
  lines: MiseEnPlaceLine[];
  dishName: (id: string) => string;
  progress: BatchProgressState;
  progressKey: string;
  hasCuts: boolean;
}) {
  const theme = useTheme();
  if (lines.length === 0) return null;
  const done = progress.checkedCount(progressKey, lines.length);

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          MISE EN PLACE {done > 0 ? `· ${done}/${lines.length}` : ''}
        </Text>
        <Text variant="caption" tone="faint">
          Tout ce qui se coupe, d’un coup, dans l’ordre de la planche : les légumes avant la viande
          et le poisson.
          {hasCuts ? '' : ' La façon de couper s’affichera avec les étapes de cuisson.'}
        </Text>
      </View>

      {lines.map((line, index) => {
        const isChecked = progress.isChecked(progressKey, index, lines.length);
        const showGroup = index === 0 || lines[index - 1]?.group !== line.group;
        return (
          <View key={line.key} style={{ gap: theme.spacing.xs }}>
            {showGroup ? (
              <Text variant="overline" style={{ color: theme.colors.spice }}>
                {GROUP_LABELS[line.group]}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              accessibilityLabel={`${line.name}, coupé`}
              onPress={() => progress.toggleStep(progressKey, index, lines.length)}
              hitSlop={6}
              style={{ flexDirection: 'row', gap: theme.spacing.md }}
            >
              <Ionicons
                name={isChecked ? 'checkbox' : 'square-outline'}
                size={22}
                color={isChecked ? theme.colors.accent : theme.colors.inkFaint}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  variant="bodyStrong"
                  style={{
                    textDecorationLine: isChecked ? 'line-through' : 'none',
                    color: isChecked ? theme.colors.inkFaint : theme.colors.ink,
                  }}
                >
                  {capitalize(line.name)}
                </Text>
                {line.shares.map((share) => (
                  <Text key={share.recipeId} tone={isChecked ? 'faint' : 'soft'}>
                    {formatQuantity(share.qty, share.unit)}
                    {share.cut ? ` ${share.cut}` : ''} – {dishName(share.recipeId)}
                  </Text>
                ))}
              </View>
            </Pressable>
          </View>
        );
      })}
    </Card>
  );
}

function CookingCard({
  entry,
  position,
  session,
  progress,
  nextName,
}: {
  entry: BatchRecipe;
  position: number;
  session: CookingSession;
  progress: BatchProgressState;
  /** Plat suivant, pour la ligne de relais. `null` pour le dernier. */
  nextName: string | null;
}) {
  const theme = useTheme();
  const { recipe, portions } = entry;
  const steps = session.steps.filter((step) => step.recipeId === recipe.id);
  const progressKey = `__cuisson:${session.generatedAt}:${recipe.id}`;
  const done = progress.checkedCount(progressKey, steps.length);

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
          {portions} portions
          {recipe.cookMinutes > 0 ? ` · ${recipe.cookMinutes} min de cuisson seule` : ''}
          {entry.needsFreezing ? ' · à congeler en portions' : ''}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          INGRÉDIENTS
        </Text>
        {scaleIngredients(recipe, portions).map((ingredient, index) => (
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
          ÉTAPES {done > 0 ? `· ${done}/${steps.length}` : ''}
        </Text>
        {steps.map((step, index) => {
          const isChecked = progress.isChecked(progressKey, index, steps.length);
          return (
            <Pressable
              key={`${progressKey}-${index}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              accessibilityLabel={`Étape ${index + 1} : ${step.text}`}
              onPress={() => progress.toggleStep(progressKey, index, steps.length)}
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
                {step.text}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {recipe.cookMinutes > 0 && nextName ? (
        // La seule vraie valeur de l'ancien entrelacement : ne pas attendre
        // devant une cocotte qui cuit seule.
        <Text variant="caption" style={{ color: theme.colors.accent }}>
          → Il cuit seul {recipe.cookMinutes} min : passe à « {nextName} » pendant ce temps.
        </Text>
      ) : null}
    </Card>
  );
}
