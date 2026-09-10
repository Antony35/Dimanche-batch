import { Pressable, View } from 'react-native';
import { Text } from './text';
import { useTheme } from '@/theme';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedSwitchProps<T extends string> {
  /**
   * Deux positions, jamais plus : au-delà, les libellés ne tiennent plus sur la
   * largeur d'un téléphone et il faudrait penser au débordement.
   */
  options: readonly [SegmentedOption<T>, SegmentedOption<T>];
  value: T;
  onChange: (value: T) => void;
}

/** Bascule entre deux vues d'un même écran. */
export function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
}: SegmentedSwitchProps<T>) {
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
      {options.map((option) => (
        <Option
          key={option.value}
          label={option.label}
          active={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
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
