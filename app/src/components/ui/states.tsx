import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '@/theme';
import { Button } from './button';
import { Text } from './text';

export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.xxl }}>
      <ActivityIndicator color={theme.colors.accent} />
      <Text tone="faint">{label}</Text>
    </View>
  );
}

/**
 * Un écran d'erreur dit ce qui s'est passé et propose une sortie. Pas de
 * `catch` silencieux dans l'app : si quelque chose échoue, ça se voit ici.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.spacing.lg,
        padding: theme.spacing.lg,
        backgroundColor: theme.colors.dangerSoft,
        borderRadius: theme.radius.lg,
      }}
    >
      <Text tone="danger">{message}</Text>
      {onRetry ? <Button label="Réessayer" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md, alignItems: 'center', paddingVertical: theme.spacing.xxl }}>
      <Text variant="heading">{title}</Text>
      {description ? (
        <Text tone="soft" style={{ textAlign: 'center' }}>
          {description}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}
