import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <Screen>
      <EmptyState
        title="Fiche recette"
        description={`Ingrédients, étapes, temps de préparation et étiquettes pour la recette ${id}. Écran construit en J5.`}
      />
    </Screen>
  );
}
