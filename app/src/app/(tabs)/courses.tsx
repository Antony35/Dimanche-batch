import { Share, View } from 'react-native';
import {
  formatGroceryListForSharing,
  getPlanningWeekId,
  type GroceryItem,
} from '@dimanche-batch/shared';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { AisleSection } from '@/features/grocery-list/components/aisle-section';
import { useGroceryList } from '@/features/grocery-list/api/use-grocery-list';
import { useToggleGroceryItem } from '@/features/grocery-list/api/use-toggle-grocery-item';
import { useHousehold } from '@/features/household/api/use-household';
import { useTheme } from '@/theme';

/** Liste de courses de la semaine, groupée dans l'ordre de parcours du magasin. */
export default function GroceryScreen() {
  const theme = useTheme();
  const { household } = useHousehold();
  const weekId = getPlanningWeekId();

  const householdId = household?.id ?? null;
  const { items, groups, checkedCount, isLoading, error } = useGroceryList(householdId, weekId);
  const toggle = useToggleGroceryItem();

  function handleToggle(item: GroceryItem) {
    if (!householdId) return;
    toggle.mutate({ householdId, weekId, itemId: item.id, checked: !item.checked });
  }

  // Ce qui est déjà dans le panier n'a pas à voyager : on partage le reste.
  // Les en-têtes de rayon sont conservés : ils se lisent, et l'import par
  // suggestion de Listonic les traverse sans en faire des articles.
  async function handleShare() {
    await Share.share({
      message: formatGroceryListForSharing(items, {
        title: `Courses — semaine du ${weekId}`,
      }),
    });
  }

  const remaining = items.length - checkedCount;
  const nothingToSend = remaining === 0;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" tone="faint">
          SEMAINE DU {weekId}
        </Text>
        <Text variant="title">Courses</Text>
        {items.length > 0 ? (
          <Text tone="soft">
            {nothingToSend
              ? 'Tout est dans le panier.'
              : `${remaining} article${remaining > 1 ? 's' : ''} à prendre sur ${items.length}`}
          </Text>
        ) : null}
      </View>

      {error ? <ErrorState message={error.message} /> : null}
      {toggle.error ? (
        <ErrorState message="La case n’a pas pu être enregistrée. Vérifie ta connexion." />
      ) : null}

      {isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucune liste pour cette semaine"
          description="La liste se construit toute seule à partir du plan de repas. Génère la semaine depuis l’accueil."
        />
      ) : (
        <>
          <Button
            label={nothingToSend ? 'Rien à partager' : 'Partager ce qui reste'}
            variant="secondary"
            disabled={nothingToSend}
            onPress={() => {
              void handleShare();
            }}
          />

          {groups.map((group) => (
            <AisleSection
              key={group.aisle}
              aisle={group.aisle}
              items={group.items}
              onToggle={handleToggle}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
