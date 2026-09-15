import { useRouter } from 'expo-router';
import { View } from 'react-native';
import type { GenerationLock, Meal, Recipe } from '@dimanche-batch/shared';
import { Button, Card, Tag, Text } from '@/components/ui';
import { GenerationProgress } from './generation-progress';
import { useTheme } from '@/theme';

/**
 * Un repas tel qu'il s'affiche partout dans l'app.
 *
 * Le composant ne sait ni lire Firestore ni régénérer quoi que ce soit : il
 * reçoit le repas et une action facultative. C'est ce qui permet de le
 * réutiliser sur l'accueil, où la régénération n'a pas sa place, et sur le
 * planning, où elle est le geste principal.
 */

const KIND_LABELS: Record<Meal['kind'], string | null> = {
  cooked: null,
  'batch-leftover': 'Portion du batch',
  'freezer-backup': 'Reste de la semaine dernière',
  'eat-out': 'Repas à l’extérieur',
  undecided: 'À décider',
};

/** Titre d'un repas qui ne cite aucune recette. */
function emptyTitle(kind: Meal['kind']): string {
  return kind === 'undecided' ? 'À décider' : 'Repas à l’extérieur';
}

export interface MealCardProps {
  label: string;
  meal: Meal;
  recipesById: Map<string, Recipe>;
  /** Absent sur l'accueil : on ne change un repas que depuis le planning. */
  onChangeMeal?: () => void;
  isRegenerating?: boolean;
  /** Avancement publié par le serveur, affiché à la place du bouton. */
  progress?: GenerationLock | null;
}

export function MealCard({
  label,
  meal,
  recipesById,
  onChangeMeal,
  isRegenerating = false,
  progress = null,
}: MealCardProps) {
  const theme = useTheme();
  const router = useRouter();
  const recipe = meal.recipeId ? recipesById.get(meal.recipeId) : undefined;
  const kindLabel = KIND_LABELS[meal.kind];
  const isUndecided = meal.kind === 'undecided';

  return (
    <Card
      onPress={recipe ? () => router.push(`/recette/${recipe.id}`) : undefined}
      style={isUndecided ? { borderColor: theme.colors.spice, borderWidth: 1 } : undefined}
    >
      <Text variant="overline" tone="faint">
        {label.toUpperCase()}
      </Text>
      <Text variant="heading" tone={isUndecided ? 'soft' : 'default'}>
        {recipe?.name ?? emptyTitle(meal.kind)}
      </Text>

      {isUndecided ? (
        <Text variant="caption" tone="soft">
          Décide-le avant les courses du samedi : ce qu’il demande s’ajoute à la liste.
        </Text>
      ) : kindLabel && recipe ? (
        <Text variant="caption" tone="soft">
          {kindLabel}
        </Text>
      ) : recipe ? (
        <Text variant="caption" tone="soft">
          {recipe.prepMinutes} min
          {recipe.cookMinutes > 0 ? ` + ${recipe.cookMinutes} min de cuisson` : ''} ·{' '}
          {recipe.servings} portions
        </Text>
      ) : null}

      {meal.withStarter || meal.withDessert ? (
        <Text variant="caption" tone="faint">
          {[meal.withStarter ? 'avec entrée' : null, meal.withDessert ? 'avec dessert' : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}

      {recipe && recipe.tags.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
          {recipe.tags.map((tag) => (
            <Tag key={tag} tag={tag} />
          ))}
        </View>
      ) : null}

      {isRegenerating ? (
        // L'attente s'affiche dans la carte où l'on a agi : un bandeau en haut
        // de l'écran serait hors de vue dès qu'on touche au milieu de semaine.
        <View style={{ marginTop: theme.spacing.xs }}>
          <GenerationProgress lock={progress} fallbackLabel="Envoi de la demande" />
        </View>
      ) : onChangeMeal ? (
        <Button
          label={isUndecided ? 'Décider ce repas' : 'Changer ce repas'}
          variant={isUndecided ? 'secondary' : 'ghost'}
          onPress={onChangeMeal}
          style={{ marginTop: theme.spacing.xs }}
        />
      ) : null}
    </Card>
  );
}
