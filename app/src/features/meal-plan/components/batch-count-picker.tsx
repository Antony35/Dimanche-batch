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
        Ils couvrent les dix repas du lundi au vendredi. Plus de plats, plus de variété — et un
        dimanche plus long.
      </Text>
    </View>
  );
}
