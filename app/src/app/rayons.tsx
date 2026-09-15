import { View } from 'react-native';
import { AISLE_LABELS, capitalize } from '@dimanche-batch/shared';
import { Card, EmptyState, ErrorState, Screen, Text } from '@/components/ui';
import { useHousehold } from '@/features/household/api/use-household';
import { useAisleLexicon } from '@/features/grocery-list/api/use-aisle-lexicon';
import { useTheme } from '@/theme';

/**
 * Les rayons que le foyer a attribués lui-même.
 *
 * Deux usages : vérifier ce que l'app a retenu, et relever les articles que la
 * table livrée ne connaissait pas, pour les y ajouter à la version suivante.
 */
export default function AisleCorrectionsScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const { overrides, error } = useAisleLexicon(household?.id ?? null);

  const entries = [...overrides.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr'));

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">Mes corrections de rayon</Text>
        <Text tone="soft">
          Chaque fois que tu choisis un rayon différent de celui proposé, il est retenu ici pour les
          deux téléphones et repasse devant la table de l’app.
        </Text>
      </View>

      {error ? <ErrorState message={error.message} /> : null}

      {entries.length === 0 ? (
        <EmptyState
          title="Aucune correction"
          description="Les articles ajoutés à la main ont tous trouvé leur rayon tout seuls."
        />
      ) : (
        <Card style={{ gap: theme.spacing.sm }}>
          {entries.map(([name, aisle]) => (
            <View
              key={name}
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.md }}
            >
              <Text style={{ flex: 1 }}>{capitalize(name)}</Text>
              <Text variant="caption" tone="soft">
                {AISLE_LABELS[aisle]}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
