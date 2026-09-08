import { EmptyState, Screen } from '@/components/ui';

export default function PlanningScreen() {
  return (
    <Screen>
      <EmptyState
        title="Planning de la semaine"
        description="Les 7 jours, midi et soir, avec régénération d'un repas isolé. Écran construit en J3."
      />
    </Screen>
  );
}
