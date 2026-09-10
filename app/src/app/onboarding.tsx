import { useState } from 'react';
import { View } from 'react-native';
import { normalizeInviteCode } from '@dimanche-batch/shared';
import { Button, Card, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { createHousehold } from '@/features/household/api/use-household';
import { joinHousehold } from '@/lib/callables';
import { useTheme } from '@/theme';

type Mode = 'choose' | 'create' | 'join';

/**
 * Écran de foyer partagé. C'est le point d'entrée obligatoire : sans foyer,
 * il n'y a ni planning ni liste de courses à afficher.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const [mode, setMode] = useState<Mode>('choose');

  return (
    <Screen contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
        <Text variant="overline" tone="accent">
          DERNIÈRE ÉTAPE
        </Text>
        <Text variant="title">Votre foyer</Text>
        <Text tone="soft">
          Le foyer relie vos deux téléphones : même planning, même liste de courses. Une seule
          personne le crée, l’autre le rejoint avec le code.
        </Text>
      </View>

      {mode === 'choose' ? (
        <View style={{ gap: theme.spacing.md }}>
          <Button label="Créer un foyer" onPress={() => setMode('create')} />
          <Button
            label="Rejoindre avec un code"
            variant="secondary"
            onPress={() => setMode('join')}
          />
        </View>
      ) : mode === 'create' ? (
        <CreateHouseholdForm uid={user?.uid ?? ''} onBack={() => setMode('choose')} />
      ) : (
        <JoinHouseholdForm onBack={() => setMode('choose')} />
      )}

      <Button label="Se déconnecter" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}

function CreateHouseholdForm({ uid, onBack }: { uid: string; onBack: () => void }) {
  const theme = useTheme();
  const [name, setName] = useState('Maison');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreate() {
    setError(null);
    setIsSubmitting(true);
    try {
      await createHousehold(uid, name);
      // Le listener temps réel du foyer débloque la navigation tout seul.
    } catch {
      setError('Impossible de créer le foyer. Vérifie ta connexion et réessaie.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: theme.spacing.lg }}>
      <TextField
        label="Nom du foyer"
        value={name}
        onChangeText={setName}
        placeholder="Maison"
        error={error}
        hint="Vous pourrez le changer plus tard."
      />
      <Button
        label="Créer"
        onPress={handleCreate}
        loading={isSubmitting}
        disabled={name.trim().length === 0}
      />
      <Button label="Retour" variant="ghost" onPress={onBack} />
    </Card>
  );
}

function JoinHouseholdForm({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleJoin() {
    setError(null);
    setIsSubmitting(true);
    try {
      await joinHousehold({ inviteCode: normalizeInviteCode(code) });
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Code invalide.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: theme.spacing.lg }}>
      <TextField
        label="Code d'invitation"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="BATCH-7F2K"
        error={error}
        hint="Le code s'affiche sur le téléphone qui a créé le foyer."
      />
      <Button
        label="Rejoindre"
        onPress={handleJoin}
        loading={isSubmitting}
        disabled={code.trim().length < 4}
      />
      <Button label="Retour" variant="ghost" onPress={onBack} />
    </Card>
  );
}
