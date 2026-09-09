import { Modal, Pressable, ScrollView, View } from 'react-native';
import { type BatchRecipe, type MealSlot } from '@dimanche-batch/shared';
import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme';

export interface MealChoiceTarget {
  date: string;
  slot: MealSlot;
  /** Nom du plat actuellement prévu, pour que l'utilisateur sache ce qu'il remplace. */
  currentRecipeName: string | null;
}

export interface MealChoiceSheetProps {
  target: MealChoiceTarget | null;
  /** Plats préparés le dimanche, seuls candidats à une portion. */
  batchRecipes: BatchRecipe[];
  onClose: () => void;
  onCook: () => void;
  onServeBatch: (recipeId: string) => void;
  onEatOut: () => void;
}

/**
 * Les trois façons de remplir un créneau.
 *
 * L'ordre et les libellés disent le coût : servir une portion ou manger dehors
 * ne demande rien à personne, cuisiner un plat neuf consomme une génération du
 * foyer. Le dire avant le geste évite d'avoir à l'expliquer après.
 */
export function MealChoiceSheet({
  target,
  batchRecipes,
  onClose,
  onCook,
  onServeBatch,
  onEatOut,
}: MealChoiceSheetProps) {
  const theme = useTheme();

  return (
    <Modal
      visible={target !== null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={{ flex: 1, backgroundColor: '#0006' }} onPress={onClose} />

      <View
        style={{
          backgroundColor: theme.colors.bg,
          borderTopLeftRadius: theme.radius.lg,
          borderTopRightRadius: theme.radius.lg,
          padding: theme.spacing.xl,
          gap: theme.spacing.lg,
          maxHeight: '75%',
        }}
      >
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="heading">Ce repas</Text>
          {target?.currentRecipeName ? (
            <Text variant="caption" tone="soft">
              Actuellement : {target.currentRecipeName}
            </Text>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={{ gap: theme.spacing.md }}>
          {batchRecipes.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="overline" tone="faint">
                UNE PORTION DU BATCH
              </Text>
              {batchRecipes.map(({ recipe }) => (
                <Card key={recipe.id} onPress={() => onServeBatch(recipe.id)}>
                  <Text variant="bodyStrong">{recipe.name}</Text>
                  <Text variant="caption" tone="faint">
                    Déjà préparé dimanche · {recipe.servings} portions
                  </Text>
                </Card>
              ))}
            </View>
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="overline" tone="faint">
              AUTRE CHOSE
            </Text>
            <Button label="Repas à l’extérieur" variant="secondary" onPress={onEatOut} />
            <Button label="Cuisiner un plat ce jour-là" variant="ghost" onPress={onCook} />
            <Text variant="caption" tone="faint">
              Cuisiner demande une nouvelle recette au modèle : cela consomme une génération du
              foyer, et modifie la liste de courses.
            </Text>
          </View>
        </ScrollView>

        <Button label="Annuler" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}
