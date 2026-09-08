import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}

export function Card({ children, onPress, style }: CardProps) {
  const theme = useTheme();
  const base: ViewStyle = {
    backgroundColor: theme.colors.bgRaised,
    borderColor: theme.colors.lineSoft,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  };

  if (!onPress) return <View style={[base, style]}>{children}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [base, { opacity: pressed ? 0.85 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}
