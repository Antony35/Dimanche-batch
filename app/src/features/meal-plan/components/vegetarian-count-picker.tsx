import { View } from 'react-native';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';
import { CountSegments } from './count-segments';

export interface VegetarianCountPickerProps {
  /** Déjà ramené au nombre de plats par l'écran : jamais plus que `batchRecipeCount`. */
  value: number;
  batchRecipeCount: number;
  onChange: (count: number) => void;
}

function describeChoice(value: number, total: number): string {
  if (value === 0) return 'Aucun nombre imposé : le modèle compose librement.';
  if (value === total) return `Les ${total} plats seront végétariens.`;
  return `${value} plat${value > 1 ? 's' : ''} végétarien${value > 1 ? 's' : ''} sur ${total}, les autres avec viande ou poisson.`;
}

/**
 * Combien de plats du batch sont végétariens.
 *
 * Borné par le nombre de plats, et zéro compris : zéro veut dire « aucune
 * contrainte », ce qui laisse la génération telle qu'elle était pour qui ne
 * s'en sert pas.
 */
export function VegetarianCountPicker({
  value,
  batchRecipeCount,
  onChange,
}: VegetarianCountPickerProps) {
  const theme = useTheme();
  const choices = Array.from({ length: batchRecipeCount + 1 }, (_, index) => index);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="overline" tone="faint">
        DONT VÉGÉTARIENS
      </Text>
      <CountSegments choices={choices} value={value} onChange={onChange} unit="plats végétariens" />
      <Text variant="caption" tone="faint">
        {describeChoice(value, batchRecipeCount)}
      </Text>
    </View>
  );
}
