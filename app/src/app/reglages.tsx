import { View } from 'react-native';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { refreshInviteCode, useHousehold } from '@/features/household/api/use-household';
import { useTheme } from '@/theme';

/**
 * Historique des semaines passées (J5). En attendant, cet écran héberge les
 * réglages du foyer — dont le code d'invitation, nécessaire dès aujourd'hui
 * pour relier le second téléphone.
 */
export default function HistoryScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const { household } = useHousehold();

  return (
    <Screen>
      <Card>
        <Text variant="overline" tone="faint">
          FOYER
        </Text>
        <Text variant="heading">{household?.name ?? '—'}</Text>
        <Text tone="soft">
          {household?.members.length ?? 0} membre
          {(household?.members.length ?? 0) > 1 ? 's' : ''}
        </Text>
      </Card>

      <Card>
        <Text variant="overline" tone="faint">
          CODE D’INVITATION
        </Text>
        {household?.inviteCode ? (
          <>
            <Text variant="display" tone="accent">
              {household.inviteCode}
            </Text>
            <Text variant="caption" tone="faint">
              À saisir sur le second téléphone. Le code est consommé dès qu’il a servi.
            </Text>
          </>
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            <Text tone="soft">Aucun code actif.</Text>
            <Button
              label="Générer un code"
              variant="secondary"
              onPress={() => {
                if (household) void refreshInviteCode(household.id);
              }}
            />
          </View>
        )}
      </Card>

      <Card>
        <Text variant="overline" tone="faint">
          COMPTE
        </Text>
        <Text tone="soft">{user?.email ?? '—'}</Text>
        <Button label="Se déconnecter" variant="ghost" onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}
