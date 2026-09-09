import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
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
  const [copiedState, setCopiedState] = useState<string | null>(null);

  const householdId = household?.id ?? null;
  const { items, groups, checkedCount, isLoading, error } = useGroceryList(householdId, weekId);
  const toggle = useToggleGroceryItem();

  function handleToggle(item: GroceryItem) {
    if (!householdId) return;
    toggle.mutate({ householdId, weekId, itemId: item.id, checked: !item.checked });
  }

  // Ce qui est déjà dans le panier n'a pas à voyager : on partage le reste.
  // Deux formats, parce que le lecteur n'est pas le même — un humain lit les
  // rayons, une application de liste les prendrait pour des articles.
  async function handleShare() {
    await Share.share({
      message: formatGroceryListForSharing(items, {
        title: `Courses — semaine du ${weekId}`,
      }),
    });
  }

  const remaining = items.length - checkedCount;
  const nothingToSend = remaining === 0;

  // La confirmation vaut pour l'état copié, pas pour toujours : cocher un
  // article rend la copie périmée, et le bouton doit le dire.
  const listState = `${items.length}/${checkedCount}`;
  const copied = copiedState === listState;

  async function handleCopy() {
    await Clipboard.setStringAsync(
      formatGroceryListForSharing(items, { includeAisleHeaders: false }),
    );
    setCopiedState(listState);
  }

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
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={copied ? 'Copié — colle-le dans Listonic' : 'Copier pour Listonic'}
              variant="secondary"
              disabled={nothingToSend}
              onPress={() => {
                void handleCopy();
              }}
            />
            <Button
              label="Partager la liste"
              variant="ghost"
              disabled={nothingToSend}
              onPress={() => {
                void handleShare();
              }}
            />
            <Text variant="caption" tone="faint">
              La copie met un article par ligne, sans les noms de rayon. Le partage garde les
              rayons : c’est la version qui se lit, pas celle qui s’importe.
            </Text>
          </View>

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
