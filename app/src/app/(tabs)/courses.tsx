import { useState } from 'react';
import { View } from 'react-native';
import {
  addDays,
  formatWeekRange,
  getCurrentWeekId,
  type GroceryItem,
} from '@dimanche-batch/shared';
import { EmptyState, ErrorState, LoadingState, Screen, StaleNotice, Text } from '@/components/ui';
import { AddGroceryItem } from '@/features/grocery-list/components/add-grocery-item';
import { AisleSection } from '@/features/grocery-list/components/aisle-section';
import { GroceryLegend } from '@/features/grocery-list/components/grocery-legend';
import { useAddGroceryItem } from '@/features/grocery-list/api/use-add-grocery-item';
import { useAisleLexicon } from '@/features/grocery-list/api/use-aisle-lexicon';
import { useSaveAisleCorrection } from '@/features/grocery-list/api/use-save-aisle-correction';
import { useDeleteGroceryItem } from '@/features/grocery-list/api/use-delete-grocery-item';
import { useGroceryList } from '@/features/grocery-list/api/use-grocery-list';
import { useToggleGroceryItem } from '@/features/grocery-list/api/use-toggle-grocery-item';
import { useHousehold } from '@/features/household/api/use-household';
import { WeekSwitch, type WeekOffset } from '@/features/meal-plan/components/week-switch';
import { useTheme } from '@/theme';

/** Liste de courses de la semaine, groupée dans l'ordre de parcours du magasin. */
export default function GroceryScreen() {
  const theme = useTheme();
  const { household } = useHousehold();

  // Les courses s'ouvrent sur la semaine à préparer : c'est pour elle qu'on
  // achète. Celle en cours reste consultable, on peut avoir oublié un article.
  const [offset, setOffset] = useState<WeekOffset>(1);
  const weekId = addDays(getCurrentWeekId(), 7 * offset);

  const householdId = household?.id ?? null;
  const { items, groups, checkedCount, isLoading, isStale, error } = useGroceryList(
    householdId,
    weekId,
  );
  const toggle = useToggleGroceryItem();
  const add = useAddGroceryItem();
  const remove = useDeleteGroceryItem();
  const lexicon = useAisleLexicon(householdId);
  const saveCorrection = useSaveAisleCorrection();

  function handleToggle(item: GroceryItem) {
    if (!householdId) return;
    toggle.mutate({ householdId, weekId, itemId: item.id, checked: !item.checked });
  }

  function handleDelete(item: GroceryItem) {
    if (!householdId) return;
    remove.mutate({ householdId, weekId, itemId: item.id });
  }

  const remaining = items.length - checkedCount;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="overline" tone="faint">
          {formatWeekRange(weekId).toUpperCase()}
        </Text>
        <Text variant="title">Courses</Text>
        <WeekSwitch value={offset} onChange={setOffset} />
        {items.length > 0 ? (
          <Text tone="soft">
            {remaining === 0
              ? 'Tout est dans le panier.'
              : `${remaining} article${remaining > 1 ? 's' : ''} à prendre sur ${items.length}`}
          </Text>
        ) : null}
      </View>

      {isStale && items.length > 0 ? <StaleNotice /> : null}
      {error ? <ErrorState message={error.message} /> : null}
      {toggle.error ? (
        <ErrorState message="La case n’a pas pu être enregistrée. Vérifie ta connexion." />
      ) : null}
      {add.error || remove.error || saveCorrection.error ? (
        <ErrorState message="La liste n’a pas pu être modifiée. Vérifie ta connexion et réessaie." />
      ) : null}

      {householdId ? (
        <AddGroceryItem
          isPending={add.isPending}
          overrides={lexicon.overrides}
          onAdd={({ correctsAisle, ...item }) => {
            add.mutate({ householdId, weekId, ...item });
            // Le rayon choisi à la main devient celui du foyer pour cet article,
            // sur les deux téléphones et pour les semaines suivantes.
            if (correctsAisle) {
              saveCorrection.mutate({ householdId, name: item.name, aisle: item.aisle });
            }
          }}
        />
      ) : null}

      {isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucune liste pour cette semaine"
          description="La liste se construit à partir du plan de repas, et tout ce que tu ajoutes à la main s’y range par rayon."
        />
      ) : (
        <>
          <GroceryLegend />
          {groups.map((group) => (
            <AisleSection
              key={group.aisle}
              aisle={group.aisle}
              items={group.items}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
