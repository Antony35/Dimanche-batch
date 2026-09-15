import { View } from 'react-native';
import { MAX_BATCH_RECIPES, MIN_BATCH_RECIPES, distributePortions } from '@dimanche-batch/shared';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';
import { CountSegments } from './count-segments';

export interface BatchCountPickerProps {
  value: number;
  onChange: (count: number) => void;
}

const CHOICES = Array.from(
  { length: MAX_BATCH_RECIPES - MIN_BATCH_RECIPES + 1 },
  (_, index) => MIN_BATCH_RECIPES + index,
);

/**
 * « 8, 6 et 6 portions » : ce que le dimanche va produire, annoncé avant de
 * générer. C'est la même répartition que celle imposée au modèle, lue au même
 * endroit du domaine.
 */
function describeChoice(count: number): string {
  const portions = distributePortions(count);
  const list =
    portions.length > 1
      ? `${portions.slice(0, -1).join(', ')} et ${portions[portions.length - 1]}`
      : String(portions[0] ?? 0);

  const sunday =
    count <= 3
      ? 'Dimanche court'
      : count <= 4
        ? 'Dimanche raisonnable'
        : count === 5
          ? 'Dimanche chargé'
          : 'Dimanche long, et deux plats ne servent qu’un repas';

  return `${list} portions pour les dix repas du lundi au vendredi. ${sunday}.`;
}

/**
 * Nombre de plats à préparer le dimanche.
 *
 * Il décide de la longueur de l'après-midi : trois plats font un dimanche court
 * mais une semaine répétitive, six font l'inverse.
 */
export function BatchCountPicker({ value, onChange }: BatchCountPickerProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="overline" tone="faint">
        PLATS À PRÉPARER DIMANCHE
      </Text>
      <CountSegments choices={CHOICES} value={value} onChange={onChange} unit="plats" />
      <Text variant="caption" tone="faint">
        {describeChoice(value)}
      </Text>
    </View>
  );
}
