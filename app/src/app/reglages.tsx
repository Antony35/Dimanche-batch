import { View } from 'react-native';
import type { Recipe } from '@dimanche-batch/shared';
import { Button, Card, ErrorState, Screen, Text } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { refreshInviteCode, useHousehold } from '@/features/household/api/use-household';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { useToggleDislike } from '@/features/recipes/api/use-recipe-verdict';
import { useTheme } from '@/theme';

/**
 * Réglages du foyer : qui en fait partie, comment y relier un second
 * téléphone, et comment en sortir. Hors des onglets à dessein — on y vient
 * rarement, et jamais au milieu des courses.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const { household } = useHousehold();
  const householdId = household?.id ?? null;
  const { recipesById } = useRecipes(householdId);
  const dislike = useToggleDislike();

  const banned = [...recipesById.values()]
    .filter((recipe) => recipe.isDisliked)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

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
          PLATS BANNIS
        </Text>
        {dislike.error ? (
          <ErrorState message="Le changement n’a pas pu être enregistré. Vérifie ta connexion." />
        ) : null}
        {banned.length === 0 ? (
          <Text tone="soft">
            Aucun plat banni. Depuis une fiche recette ou le planning, un plat qui ne vous plaît
            pas sort définitivement des propositions.
          </Text>
        ) : (
          <>
            <Text variant="caption" tone="faint">
              Ces plats ne seront plus jamais proposés par l’IA.
            </Text>
            {banned.map((recipe) => (
              <BannedRow
                key={recipe.id}
                recipe={recipe}
                onRestore={() => {
                  if (householdId) {
                    dislike.mutate({ householdId, recipeId: recipe.id, isDisliked: false });
                  }
                }}
              />
            ))}
          </>
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

/** Un plat banni, et de quoi revenir sur ce jugement. */
function BannedRow({ recipe, onRestore }: { recipe: Recipe; onRestore: () => void }) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        marginTop: theme.spacing.sm,
      }}
    >
      <Text style={{ flex: 1 }}>{recipe.name}</Text>
      <Button label="Rétablir" variant="ghost" onPress={onRestore} />
    </View>
  );
}
