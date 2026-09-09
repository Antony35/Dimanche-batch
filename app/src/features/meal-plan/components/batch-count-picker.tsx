import { Pressable, View } from 'react-native';
import { MAX_BATCH_RECIPES, MIN_BATCH_RECIPES } from '@dimanche-batch/shared';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

export interface BatchCountPickerProps {
  value: number;
  onChange: (count: number) => void;
}

const CHOICES = Array.from(
  { length: MAX_BATCH_RECIPES - MIN_BATCH_RECIPES + 1 },
  (_, index) => MIN_BATCH_RECIPES + index,
);

/**
 * Nombre de plats à préparer le dimanche.
 *
 * C'est le seul réglage de la génération, et il décide de la longueur de
 * l'après-midi : trois plats font un dimanche court mais une semaine répétitive,
 * six font l'inverse.
 */
/**
 * Dix repas à couvrir, deux portions chacun : le nombre de plats décide de la
 * fréquence à laquelle chacun revient, et de la longueur du dimanche.
 */
function describeChoice(count: number): string {
  const mealsPerRecipe = Math.round(10 / count);
  const repetition =
    mealsPerRecipe >= 3
      ? `chaque plat revient environ ${mealsPerRecipe} fois dans la semaine`
      : `chaque plat revient ${mealsPerRecipe} fois seulement`;

  const sunday =
    count <= 3
      ? 'Dimanche court'
      : count <= 4
        ? 'Dimanche raisonnable'
        : count === 5
          ? 'Dimanche chargé'
          : 'Dimanche long';

  return `${count} plats pour les dix repas du lundi au vendredi : ${repetition}. ${sunday}.`;
}

export function BatchCountPicker({ value, onChange }: BatchCountPickerProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="overline" tone="faint">
        PLATS À PRÉPARER DIMANCHE
      </Text>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {CHOICES.map((count) => {
          const active = count === value;
          return (
            <Pressable
              key={count}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${count} plats`}
              onPress={() => onChange(count)}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: theme.spacing.md,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: active ? theme.colors.accent : theme.colors.line,
                backgroundColor: active ? theme.colors.accentSoft : 'transparent',
              }}
            >
              <Text
                variant="bodyStrong"
                style={{ color: active ? theme.colors.accent : theme.colors.inkSoft }}
              >
                {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text variant="caption" tone="faint">
        {describeChoice(value)}
      </Text>
    </View>
  );
}
