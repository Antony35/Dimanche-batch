import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

export interface WeekSwitchProps {
  /** Vrai si la semaine affichée est celle qu'on mange. */
  showingCurrent: boolean;
  onChange: (showCurrent: boolean) => void;
}

/**
 * Bascule entre la semaine en cours et celle à préparer.
 *
 * Les deux coexistent en permanence dans ce cycle : on mange celle du samedi
 * dernier pendant qu'on achète et cuisine la suivante. Chaque écran s'ouvre sur
 * la sienne, mais doit laisser aller voir l'autre.
 */
export function WeekSwitch({ showingCurrent, onChange }: WeekSwitchProps) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.bgRaised,
        borderColor: theme.colors.lineSoft,
        borderWidth: 1,
        borderRadius: theme.radius.md,
        padding: 3,
      }}
    >
      <Option label="Cette semaine" active={showingCurrent} onPress={() => onChange(true)} />
      <Option label="Semaine prochaine" active={!showingCurrent} onPress={() => onChange(false)} />
    </View>
  );
}

function Option({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radius.sm,
        backgroundColor: active ? theme.colors.accentSoft : 'transparent',
      }}
    >
      <Text variant="caption" style={{ color: active ? theme.colors.accent : theme.colors.inkSoft }}>
        {label}
      </Text>
    </Pressable>
  );
}
