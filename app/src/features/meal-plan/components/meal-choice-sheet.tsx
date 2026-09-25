import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import {
  BATCH_DAY_INDEX,
  MAX_ONE_POT_MINUTES,
  type BatchRecipe,
  type MealSlot,
  type MealStyle,
  type Recipe,
} from '@dimanche-batch/shared';
import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme';

export interface MealChoiceTarget {
  date: string;
  slot: MealSlot;
  /** 0 = samedi … 6 = vendredi : décide des gestes proposés. */
  dayIndex: number;
  /** Nom du plat actuellement prévu, pour que l'utilisateur sache ce qu'il remplace. */
  currentRecipeName: string | null;
  /** Identifiant du même plat : le bannissement écrit sur son document. */
  currentRecipeId: string | null;
  /** Vrai si le foyer l'a déjà banni — le bouton devient alors une levée. */
  isCurrentDisliked: boolean;
  /** Vrai si le créneau sert une portion du batch de cette semaine. */
  isBatchPortion: boolean;
  /** Vrai si c'est le dernier repas de son plat du batch : le vider retire le plat. */
  isLastMealOfDish: boolean;
  /** Vrai si le créneau est encore à décider. */
  isUndecided: boolean;
  /** Vrai si le dimanche du batch est passé : les plats sont au frigo. */
  isBatchCooked: boolean;
}

export interface MealChoiceSheetProps {
  target: MealChoiceTarget | null;
  /** Plats du batch de la semaine, pour servir une portion le week-end. */
  batchRecipes: BatchRecipe[];
  /** Plats du batch qu'on peut échanger avec ce créneau, déjà filtrés par le domaine. */
  swapTargets: Recipe[];
  /** Plats du batch de la semaine précédente, dont il peut rester des portions. */
  previousLeftovers: Recipe[];
  onClose: () => void;
  onSwap: (recipeId: string) => void;
  onServeBatch: (recipeId: string) => void;
  onPreviousLeftover: (recipeId: string) => void;
  onEatOut: () => void;
  onCook: (style: MealStyle) => void;
  /** Retire du batch le plat que sert ce créneau. */
  onRemoveDish: () => void;
  /** Bannit le plat en place, ou lève son bannissement. */
  onDislike: (isDisliked: boolean) => void;
}

/**
 * Les façons de remplir un créneau, selon le jour.
 *
 * Du lundi au vendredi, on ne cuisine pas : on échange avec un autre plat du
 * batch, on finit un reste, ou on mange dehors — et un créneau à décider peut
 * reprendre une portion du batch. Le samedi et le dimanche, on peut aussi
 * cuisiner. L'ordre et les libellés disent le coût : échanger ne change pas la
 * liste de courses, un reste ou un repas dehors l'allège, cuisiner l'alourdit
 * et consomme une génération.
 *
 * Vider le dernier repas d'un plat du batch retire le plat, tant qu'il n'est
 * pas cuisiné : la feuille le dit avant qu'on choisisse.
 */
export function MealChoiceSheet({
  target,
  batchRecipes,
  swapTargets,
  previousLeftovers,
  onClose,
  onSwap,
  onServeBatch,
  onPreviousLeftover,
  onEatOut,
  onCook,
  onRemoveDish,
  onDislike,
}: MealChoiceSheetProps) {
  const theme = useTheme();
  const isWeekend = (target?.dayIndex ?? 0) <= BATCH_DAY_INDEX;
  const isLastMeal = target?.isLastMealOfDish ?? false;
  const isBatchCooked = target?.isBatchCooked ?? false;
  // Le dernier repas d'un plat ne se vide qu'avant le batch : après, le plat
  // est au frigo, et il faudra bien le manger.
  const canEmpty = !isLastMeal || !isBatchCooked;
  // Une portion de plus, c'est deux portions de plus à cuisiner : possible le
  // week-end, ou sur un créneau libre tant que le batch n'est pas fait. Jamais
  // sur le dernier repas d'un plat — l'échange fait la même chose sans le perdre.
  const canServeBatch =
    !isLastMeal && (isWeekend || ((target?.isUndecided ?? false) && !isBatchCooked));

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
          maxHeight: '80%',
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

        {target?.isCurrentDisliked ? (
          <Card>
            <Text variant="bodyStrong">Noté, on ne te le reproposera plus.</Text>
            <Text variant="caption" tone="soft">
              Il reste au menu cette semaine : choisis ci-dessous pour le remplacer, ou garde-le une
              dernière fois.
            </Text>
          </Card>
        ) : null}

        <ScrollView contentContainerStyle={{ gap: theme.spacing.lg }}>
          {target?.isBatchPortion ? (
            <Section title="ÉCHANGER AVEC UN AUTRE PLAT DU BATCH">
              {swapTargets.length > 0 ? (
                <>
                  {swapTargets.map((recipe) => (
                    <Card key={recipe.id} onPress={() => onSwap(recipe.id)}>
                      <Text variant="bodyStrong">{recipe.name}</Text>
                    </Card>
                  ))}
                  <Text variant="caption" tone="faint">
                    Les portions sont comptées : le repas le plus éloigné qui servait ce plat
                    reprend celui-ci. La liste de courses ne change pas.
                  </Text>
                </>
              ) : (
                <Text variant="caption" tone="faint">
                  Aucun échange possible : un plat qui ne se congèle pas ne peut pas attendre la fin
                  de semaine.
                </Text>
              )}
            </Section>
          ) : null}

          {canServeBatch && batchRecipes.length > 0 ? (
            <Section title="UNE PORTION DU BATCH">
              {batchRecipes.map(({ recipe }) => (
                <Card key={recipe.id} onPress={() => onServeBatch(recipe.id)}>
                  <Text variant="bodyStrong">{recipe.name}</Text>
                  <Text variant="caption" tone="faint">
                    Préparé dimanche avec les autres : deux portions de plus à cuisiner et à acheter
                  </Text>
                </Card>
              ))}
            </Section>
          ) : null}

          {canEmpty ? (
            <>
              {isLastMeal ? (
                <Card>
                  <Text variant="bodyStrong">C’est le dernier repas de ce plat</Text>
                  <Text variant="caption" tone="soft">
                    Le remplacer par un reste ou un repas dehors retire le plat du batch : il ne
                    sera ni cuisiné dimanche ni acheté.
                  </Text>
                </Card>
              ) : null}

              {previousLeftovers.length > 0 ? (
                <Section title="UN RESTE DE LA SEMAINE DERNIÈRE">
                  {previousLeftovers.map((recipe) => (
                    <Card key={recipe.id} onPress={() => onPreviousLeftover(recipe.id)}>
                      <Text variant="bodyStrong">{recipe.name}</Text>
                    </Card>
                  ))}
                  <Text variant="caption" tone="faint">
                    Déjà cuisiné : rien à acheter, et le plat de cette semaine qui servait ce repas
                    s’achète pour une portion de moins.
                  </Text>
                </Section>
              ) : null}

              <Section title="AUTRE CHOSE">
                <Button label="Repas à l’extérieur" variant="secondary" onPress={onEatOut} />
              </Section>
            </>
          ) : (
            <Card>
              <Text variant="bodyStrong">C’est le dernier repas de ce plat</Text>
              <Text variant="caption" tone="soft">
                Le batch est cuisiné : le plat attend au frigo. Échange-le plutôt avec un autre
                repas.
              </Text>
            </Card>
          )}

          {isWeekend && !isLastMeal ? (
            <Section title="CUISINER CE JOUR-LÀ">
              <Button
                label="Un one-pot, rapide"
                variant="ghost"
                onPress={() => onCook('one-pot')}
              />
              <Text variant="caption" tone="faint">
                Une seule casserole, {MAX_ONE_POT_MINUTES} minutes au plus.
              </Text>
              <Button
                label="Un vrai plat cuisiné"
                variant="ghost"
                onPress={() => onCook('elaborate')}
              />
              <Text variant="caption" tone="faint">
                Sans limite de temps ni d’ustensiles. Les deux demandent une recette au modèle :
                cela consomme une génération du foyer, et ses ingrédients s’ajoutent à la liste en «
                frais ».
              </Text>
            </Section>
          ) : null}

          {target?.isBatchPortion && !isBatchCooked ? (
            <Section title="CUISINER MOINS">
              <Button label="Retirer ce plat du batch" variant="ghost" onPress={onRemoveDish} />
              <Text variant="caption" tone="faint">
                Le frigo est déjà plein ? Le plat n’est ni cuisiné ni acheté, et tous ses repas
                passent à décider. Rien n’est consommé.
              </Text>
            </Section>
          ) : null}

          {target?.currentRecipeId ? (
            <Section title="CE PLAT NE ME PLAÎT PAS">
              <Button
                label={
                  target.isCurrentDisliked
                    ? 'Finalement, on peut me le reproposer'
                    : 'Ne plus jamais me le proposer'
                }
                variant="ghost"
                onPress={() => onDislike(!target.isCurrentDisliked)}
              />
              <Text variant="caption" tone="faint">
                Le plat sort des propositions du foyer, pour cette semaine comme pour les suivantes.
                Rien n’est consommé, et la liste des plats bannis se relit dans les réglages.
              </Text>
            </Section>
          ) : null}
        </ScrollView>

        <Button label="Annuler" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="overline" tone="faint">
        {title}
      </Text>
      {children}
    </View>
  );
}
