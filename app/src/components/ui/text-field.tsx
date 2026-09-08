import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
}

export function TextField({ label, error, hint, ...props }: TextFieldProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="overline" tone="faint">
        {label.toUpperCase()}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.inkFaint}
        style={[
          styles.input,
          theme.typography.body,
          {
            backgroundColor: theme.colors.bgRaised,
            color: theme.colors.ink,
            borderColor: error ? theme.colors.danger : theme.colors.line,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.lg,
          },
        ]}
        {...props}
      />
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, minHeight: 48 },
});
