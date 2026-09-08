import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const isInactive = disabled || loading;

  const background: Record<Variant, string> = {
    primary: theme.colors.accent,
    secondary: theme.colors.accentSoft,
    ghost: 'transparent',
  };
  const labelColor: Record<Variant, string> = {
    primary: theme.colors.accentInk,
    secondary: theme.colors.accent,
    ghost: theme.colors.accent,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      onPress={onPress}
      disabled={isInactive}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background[variant],
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.md + 2,
          paddingHorizontal: theme.spacing.xl,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: theme.colors.line,
          opacity: isInactive ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor[variant]} />
      ) : (
        <Text variant="bodyStrong" style={{ color: labelColor[variant] }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
});
