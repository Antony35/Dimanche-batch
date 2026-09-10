import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { splitByVerdict } from '@dimanche-batch/shared';
import { Button, Card, Screen, SegmentedSwitch, Text } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { refreshInviteCode, useHousehold } from '@/features/household/api/use-household';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useTheme, useThemePreference, type ThemePreference } from '@/theme';

/**
 * Réglages du foyer : qui en fait partie, comment y relier un second
 * téléphone, et comment en sortir. Hors des onglets à dessein — on y vient
 * rarement, et jamais au milieu des courses.
 */
/** Ce que chaque choix promet, sous le sélecteur. */
const THEME_HINTS: Record<ThemePreference, string> = {
  system: 'L’app suit le réglage du téléphone, et bascule avec lui.',
  light: 'Toujours en clair, quel que soit le réglage du téléphone.',
  dark: 'Toujours en sombre, quel que soit le réglage du téléphone.',
};

const THEME_OPTIONS = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
] as const;

export default function SettingsScreen() {
  const theme = useTheme();
  const { preference, setPreference } = useThemePreference();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { household } = useHousehold();

  // Le seul usage des recettes ici : dire s'il vaut la peine d'ouvrir l'écran
  // des goûts. Deux nombres valent mieux qu'une ligne muette.
  const { recipesById } = useRecipes(household?.id ?? null);
  const tastes = splitByVerdict(recipesById.values());

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

      <Card onPress={() => router.push('/gouts')}>
        <Text variant="overline" tone="faint">
          GOÛTS DU FOYER
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Text tone="soft" style={{ flex: 1 }}>
            {tastes.favorite.length} favori{tastes.favorite.length > 1 ? 's' : ''} ·{' '}
            {tastes.banned.length} banni{tastes.banned.length > 1 ? 's' : ''}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.inkFaint} />
        </View>
      </Card>

      <Card>
        <Text variant="overline" tone="faint">
          APPARENCE
        </Text>
        <SegmentedSwitch options={THEME_OPTIONS} value={preference} onChange={setPreference} />
        <Text variant="caption" tone="faint">
          {THEME_HINTS[preference]} Ce choix ne vaut que pour ce téléphone.
        </Text>
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
