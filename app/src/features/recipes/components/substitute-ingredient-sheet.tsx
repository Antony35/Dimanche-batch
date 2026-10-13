import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native';
import {
  formatQuantity,
  matchesSubstituteQuery,
  substituteCandidates,
  substituteCategory,
  substituteCategoryLabel,
  substitutionProblem,
  type Ingredient,
  type Recipe,
} from '@dimanche-batch/shared';
import { Card, Text, TextField } from '@/components/ui';
import { useTheme } from '@/theme';

export interface SubstituteIngredientSheetProps {
  recipe: Recipe;
  /** Ingrédient à remplacer ; `null` ferme la feuille. */
  ingredient: Ingredient | null;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSubstitute: (substitute: string) => void;
}

/**
 * Remplacer un ingrédient par un autre de la même catégorie.
 *
 * Les remplaçants s'affichent en pastilles, tous d'un coup : une catégorie en
 * compte rarement plus de soixante, et on reconnaît un mot plus vite qu'on ne le
 * tape. La recherche filtre, et ce qu'elle ne trouve pas peut quand même être
 * utilisé — un produit local que la table ignore —, à condition que la règle
 * du domaine l'accepte : elle le dit ici, avant tout appel.
 */
export function SubstituteIngredientSheet({
  recipe,
  ingredient,
  isPending,
  error,
  onClose,
  onSubstitute,
}: SubstituteIngredientSheetProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const category = ingredient ? substituteCategory(ingredient.name, ingredient.aisle) : null;
  const candidates = ingredient
    ? substituteCandidates(ingredient, recipe).filter((candidate) =>
        matchesSubstituteQuery(candidate, query),
      )
    : [];
  const typed = query.trim();
  const isListed = candidates.some((candidate) => candidate.name === typed.toLocaleLowerCase('fr'));
  const typedProblem =
    ingredient && typed && !isListed ? substitutionProblem(recipe, ingredient.name, typed) : null;
  const original = ingredient?.originalName ?? null;

  function close() {
    setQuery('');
    onClose();
  }

  function choose(name: string) {
    if (!isPending) onSubstitute(name);
  }

  return (
    <Modal
      visible={ingredient !== null}
      animationType="slide"
      transparent
      onRequestClose={close}
      accessibilityViewIsModal
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: '#0006' }} onPress={close} />

        <View
          style={{
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            padding: theme.spacing.xl,
            gap: theme.spacing.lg,
            maxHeight: '85%',
          }}
        >
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="heading">Remplacer {ingredient?.name}</Text>
            {ingredient && category ? (
              <Text variant="caption" tone="soft">
                {substituteCategoryLabel(category)} · même quantité,{' '}
                {formatQuantity(ingredient.qty, ingredient.unit)}
              </Text>
            ) : null}
          </View>

          <TextField
            label="Chercher ou saisir"
            placeholder="aubergine, dinde, quinoa…"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
          />

          {error ? (
            <Text variant="caption" tone="danger">
              {error}
            </Text>
          ) : null}
          {isPending ? (
            <Text variant="caption" tone="soft">
              Remplacement en cours, la liste de courses suit…
            </Text>
          ) : null}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: theme.spacing.md }}
          >
            {original && !query ? (
              <Card onPress={() => choose(original)}>
                <Text variant="bodyStrong">Revenir à {original}</Text>
                <Text variant="caption" tone="soft">
                  Ce que la recette demandait au départ.
                </Text>
              </Card>
            ) : null}

            {typed && !isListed ? (
              typedProblem ? (
                <Text variant="caption" tone="danger">
                  {typedProblem}
                </Text>
              ) : (
                <Card onPress={() => choose(typed)}>
                  <Text variant="bodyStrong">Utiliser « {typed} »</Text>
                  <Text variant="caption" tone="soft">
                    Absent de la liste : il sera rangé au même rayon que {ingredient?.name}.
                  </Text>
                </Card>
              )
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {candidates.map((candidate) => (
                <Pressable
                  key={candidate.name}
                  accessibilityRole="button"
                  accessibilityLabel={`Remplacer par ${candidate.name}`}
                  disabled={isPending}
                  onPress={() => choose(candidate.name)}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? theme.colors.accent : theme.colors.accentSoft,
                    borderRadius: theme.radius.lg,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    opacity: isPending ? 0.5 : 1,
                  })}
                >
                  {({ pressed }) => (
                    <Text style={{ color: pressed ? theme.colors.accentInk : theme.colors.accent }}>
                      {candidate.name}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>

            {candidates.length === 0 && !typed ? (
              <Text variant="caption" tone="faint">
                Aucun remplaçant connu : saisis-en un ci-dessus.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
