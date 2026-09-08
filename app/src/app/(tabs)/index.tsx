import { View } from 'react-native';
import { getDayNameForDate, getPlanningWeekId, toIsoDate } from '@dimanche-batch/shared';
import { Card, EmptyState, Screen, Text } from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { useTheme } from '@/theme';

/**
 * Écran d'accueil : ce qu'on mange aujourd'hui, midi et soir.
 * Le contenu réel arrive avec la génération du plan (J2/J3).
 */
export default function TodayScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const today = toIsoDate(new Date());

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          {getDayNameForDate(today).toUpperCase()}
        </Text>
        <Text variant="title">{household?.name ?? 'Foyer'}</Text>
      </View>

      <Card>
        <Text variant="overline" tone="faint">
          SEMAINE PLANIFIÉE
        </Text>
        <Text variant="bodyStrong">{getPlanningWeekId()}</Text>
      </Card>

      <EmptyState
        title="Pas encore de plan"
        description="La génération du dimanche arrive à l'étape suivante du développement. Le foyer est prêt, la synchronisation entre vos deux téléphones fonctionne."
      />
    </Screen>
  );
}
