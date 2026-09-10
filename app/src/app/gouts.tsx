import { useState } from 'react';
import { View } from 'react-native';
import { splitByVerdict } from '@dimanche-batch/shared';
import { EmptyState, ErrorState, LoadingState, Screen, SegmentedSwitch, Text } from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import { PreferenceCard } from '@/features/recipes/components/preference-card';
import { useToggleDislike, useToggleFavorite } from '@/features/recipes/api/use-recipe-verdict';
import { useTheme } from '@/theme';

type Verdict = 'favorite' | 'banned';

const OPTIONS = [
  { value: 'favorite', label: 'Favoris' },
  { value: 'banned', label: 'Jamais plus' },
] as const;

/**
 * Ce que le foyer aime et ce qu'il refuse, au même endroit.
 *
 * Les deux listes sont les deux valeurs d'un même réglage — un plat passe de
 * l'une à l'autre — et c'est ce que le sélecteur donne à voir. Les séparer en
 * deux écrans cacherait ce lien.
 */
export default function TastesScreen() {
  const theme = useTheme();
  const { household } = useHousehold();

  const householdId = household?.id ?? null;
  const { recipesById, isLoading } = useRecipes(householdId);
  const favorite = useToggleFavorite();
  const dislike = useToggleDislike();

  const [verdict, setVerdict] = useState<Verdict>('favorite');
  const { favorites, banned } = splitByVerdict(recipesById.values());
  const recipes = verdict === 'favorite' ? favorites : banned;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.sm }}>
        <SegmentedSwitch options={OPTIONS} value={verdict} onChange={setVerdict} />
        <Text variant="caption" tone="faint">
          {verdict === 'favorite'
            ? 'Le modèle peut en reprendre un, au maximum, dans une semaine qu’il compose.'
            : 'Ces plats ne seront plus jamais proposés, ni eux ni une variante proche.'}
        </Text>
      </View>

      {favorite.error || dislike.error ? (
        <ErrorState message="Ton choix n’a pas pu être enregistré. Vérifie ta connexion." />
      ) : null}

      {isLoading ? (
        <LoadingState />
      ) : recipes.length === 0 ? (
        <EmptyState
          title={verdict === 'favorite' ? 'Aucun favori' : 'Aucun plat banni'}
          description={
            verdict === 'favorite'
              ? 'Le cœur, sur une fiche recette, met un plat de côté. Le modèle pourra en reproposer un de temps en temps.'
              : 'Depuis une fiche recette ou la feuille « Changer ce repas », un plat qui ne vous plaît pas sort définitivement des propositions.'
          }
        />
      ) : (
        recipes.map((recipe) => (
          <PreferenceCard
            key={recipe.id}
            recipe={recipe}
            verdict={verdict}
            onToggle={() => {
              if (!householdId) return;
              if (verdict === 'favorite') {
                favorite.mutate({ householdId, recipeId: recipe.id, isFavorite: false });
              } else {
                dislike.mutate({ householdId, recipeId: recipe.id, isDisliked: false });
              }
            }}
          />
        ))
      )}
    </Screen>
  );
}
