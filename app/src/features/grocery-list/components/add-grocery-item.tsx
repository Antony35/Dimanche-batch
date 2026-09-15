import { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  AISLES,
  AISLE_LABELS,
  capitalize,
  guessAisle,
  lookupAisle,
  type Aisle,
  type Unit,
} from '@dimanche-batch/shared';
import { Button, Card, Text, TextField } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Unités proposées pour un ajout à la main.
 *
 * Volontairement courtes : on ajoute « 2 courgettes » ou « 1 kg de farine », pas
 * une pincée. Les cuillerées et les gousses viennent des recettes, jamais d'un
 * ajout debout dans un rayon.
 */
const UNIT_CHOICES: { unit: Unit; label: string }[] = [
  { unit: 'piece', label: 'pièce' },
  { unit: 'g', label: 'g' },
  { unit: 'kg', label: 'kg' },
  { unit: 'ml', label: 'ml' },
  { unit: 'l', label: 'L' },
  { unit: 'botte', label: 'botte' },
];

export interface AddGroceryItemProps {
  /**
   * `correctsAisle` est vrai quand le rayon retenu diffère de ce que la table et
   * le lexique du foyer auraient dit : c'est une correction à retenir.
   */
  onAdd: (item: {
    name: string;
    qty: number;
    unit: Unit;
    aisle: Aisle;
    correctsAisle: boolean;
  }) => void;
  isPending: boolean;
  /** Corrections déjà faites par le foyer, qui passent devant la table livrée. */
  overrides: ReadonlyMap<string, Aisle>;
}

/**
 * Ajout d'un article, replié tant qu'on ne s'en sert pas.
 *
 * Le rayon est deviné dès que le nom est saisi, et le champ reste ouvert à la
 * correction : c'est ce qui évite de faire choisir un rayon parmi onze à chaque
 * article, sans jamais en imposer un faux. Le nom passe par un champ de texte
 * ordinaire, donc le micro du clavier le dicte sans qu'on ajoute quoi que ce
 * soit à l'app.
 */
export function AddGroceryItem({ onAdd, isPending, overrides }: AddGroceryItemProps) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<Unit>('piece');
  const [chosenAisle, setChosenAisle] = useState<Aisle | null>(null);

  // Dérivé au rendu et non posé dans un effet : le rayon suit le nom tant que
  // personne ne l'a corrigé, et la correction gagne ensuite.
  const known = name.trim().length > 0 ? lookupAisle(name, overrides) : null;
  const aisle = chosenAisle ?? guessAisle(name, overrides);
  const parsedQty = Number(qty.replace(',', '.'));
  const canSubmit = name.trim().length > 0 && Number.isFinite(parsedQty) && parsedQty > 0;

  function reset() {
    setName('');
    setQty('1');
    setUnit('piece');
    setChosenAisle(null);
  }

  if (!isOpen) {
    return (
      <Button
        label="Ajouter un article"
        variant="secondary"
        onPress={() => {
          setIsOpen(true);
        }}
      />
    );
  }

  return (
    <Card style={{ gap: theme.spacing.lg }}>
      <TextField
        label="Article"
        value={name}
        onChangeText={setName}
        placeholder="sac poubelle, lait, courgettes…"
        autoFocus
        autoCapitalize="none"
      />

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.md }}>
        <View style={{ width: 88 }}>
          <TextField label="Quantité" value={qty} onChangeText={setQty} keyboardType="numeric" />
        </View>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {UNIT_CHOICES.map((choice) => (
            <Chip
              key={choice.unit}
              label={choice.label}
              selected={choice.unit === unit}
              onPress={() => {
                setUnit(choice.unit);
              }}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="overline" tone="faint">
          RAYON{' '}
          {chosenAisle === null && name.trim().length > 0
            ? known
              ? '· DEVINÉ'
              : '· INCONNU, CHOISIS-LE'
            : ''}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {AISLES.map((candidate) => (
            <Chip
              key={candidate}
              label={AISLE_LABELS[candidate]}
              selected={candidate === aisle}
              onPress={() => {
                setChosenAisle(candidate);
              }}
            />
          ))}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <Button
          label="Annuler"
          variant="ghost"
          style={{ flex: 1 }}
          onPress={() => {
            reset();
            setIsOpen(false);
          }}
        />
        <Button
          label="Ajouter"
          style={{ flex: 1 }}
          disabled={!canSubmit}
          loading={isPending}
          onPress={() => {
            onAdd({
              name: name.trim(),
              qty: parsedQty,
              unit,
              aisle,
              correctsAisle: chosenAisle !== null && chosenAisle !== known,
            });
            reset();
          }}
        />
      </View>
    </Card>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function Chip({ label, selected, onPress }: ChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: selected ? theme.colors.accent : theme.colors.bg,
        borderColor: selected ? theme.colors.accent : theme.colors.line,
        borderWidth: 1,
        borderRadius: theme.radius.pill,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        variant="caption"
        style={{ color: selected ? theme.colors.accentInk : theme.colors.inkSoft }}
      >
        {capitalize(label)}
      </Text>
    </Pressable>
  );
}
