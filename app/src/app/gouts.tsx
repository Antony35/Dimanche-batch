import { useState } from 'react';
import { View } from 'react-native';
import { splitByVerdict, type RecipeVerdict } from '@dimanche-batch/shared';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  SegmentedSwitch,
  Text,
} from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { useRecipes } from '@/features/meal-plan/api/use-recipes';
import {
  VERDICT_WRITE_ERROR,
  useToggleDislike,
  useToggleFavorite,
} from '@/features/recipes/api/use-recipe-verdict';
import { PreferenceCard } from '@/features/recipes/components/preference-card';
import { useTheme } from '@/theme';

/**
 * Tout ce qui distingue les deux listes, au même endroit.
 *
 * Un écran qui rebranche cinq fois sur le même discriminant finit par en
 * oublier une : le jour où l'on ajoute un troisième verdict, c'est ici, et ici
 * seulement, qu'il manque quelque chose.
 */
const VERDICTS: Record<
  RecipeVerdict,
  { label: string; caption: string; emptyTitle: string; emptyDescription: string }
> = {
  favorite: {
    label: 'Favoris',
    caption: 'Le modèle peut en reprendre un, au maximum, dans une semaine qu’il compose.',
    emptyTitle: 'Aucun favori',
    emptyDescription:
      'Le cœur, sur une fiche recette, met un plat de côté. Le modèle pourra en reproposer un de temps en temps.',
  },
  banned: {
    label: 'Jamais plus',
    caption: 'Ces plats ne seront plus jamais proposés, ni eux ni une variante proche.',
    emptyTitle: 'Aucun plat banni',
    emptyDescription:
      'Depuis une fiche recette ou la feuille « Changer ce repas », un plat qui ne vous plaît pas sort définitivement des propositions.',
  },
};

const OPTIONS = [
  { value: 'favorite', label: VERDICTS.favorite.label },
  { value: 'banned', label: VERDICTS.banned.label },
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

  const [verdict, setVerdict] = useState<RecipeVerdict>('favorite');
  const recipes = splitByVerdict(recipesById.values())[verdict];
  const labels = VERDICTS[verdict];

  /** Lève le verdict, sans jamais le remplacer par l'autre. */
  function clearVerdict(recipeId: string) {
    if (!householdId) return;
    if (verdict === 'favorite') favorite.mutate({ householdId, recipeId, isFavorite: false });
    else dislike.mutate({ householdId, recipeId, isDisliked: false });
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.sm }}>
        <SegmentedSwitch options={OPTIONS} value={verdict} onChange={setVerdict} />
        <Text variant="caption" tone="faint">
          {labels.caption}
        </Text>
      </View>

      {favorite.error || dislike.error ? <ErrorState message={VERDICT_WRITE_ERROR} /> : null}

      {isLoading ? (
        <LoadingState />
      ) : recipes.length === 0 ? (
        <EmptyState title={labels.emptyTitle} description={labels.emptyDescription} />
      ) : (
        recipes.map((recipe) => (
          <PreferenceCard
            key={recipe.id}
            recipe={recipe}
            verdict={verdict}
            onToggle={() => clearVerdict(recipe.id)}
          />
        ))
      )}
    </Screen>
  );
}
