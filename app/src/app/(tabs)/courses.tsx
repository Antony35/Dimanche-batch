import { EmptyState, Screen } from '@/components/ui';

export default function GroceryScreen() {
  return (
    <Screen>
      <EmptyState
        title="Liste de courses"
        description="Ingrédients agrégés par rayon, cases à cocher synchronisées et partage vers Listonic. Écran construit en J4."
      />
    </Screen>
  );
}
