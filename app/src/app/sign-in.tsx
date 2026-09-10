import { useState } from 'react';
import { View } from 'react-native';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useTheme } from '@/theme';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSignUp = mode === 'sign-up';
  const canSubmit =
    email.includes('@') && password.length >= 6 && (!isSignUp || displayName.trim().length > 0);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      if (isSignUp) await signUp(email, password, displayName);
      else await signIn(email, password);
      // La navigation suit l'état d'authentification, il n'y a rien à pousser ici.
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Connexion impossible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen contentStyle={{ justifyContent: 'center', flexGrow: 1 }}>
      <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.lg }}>
        <Text variant="overline" tone="accent">
          DIMANCHE BATCH
        </Text>
        <Text variant="display">{isSignUp ? 'Créer un compte' : 'Bon retour'}</Text>
        <Text tone="soft">
          {isSignUp
            ? 'Un compte par personne ; vous rejoindrez ensuite le même foyer.'
            : 'Connecte-toi pour retrouver le planning de la semaine.'}
        </Text>
      </View>

      {isSignUp ? (
        <TextField
          label="Prénom"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          autoComplete="given-name"
          placeholder="Antony"
        />
      ) : null}

      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        placeholder="prenom@exemple.fr"
      />

      <TextField
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={isSignUp ? 'new-password' : 'current-password'}
        hint={isSignUp ? 'Au moins 6 caractères.' : undefined}
        error={error}
      />

      <Button
        label={isSignUp ? 'Créer le compte' : 'Se connecter'}
        onPress={handleSubmit}
        disabled={!canSubmit}
        loading={isSubmitting}
      />

      <Button
        variant="ghost"
        label={isSignUp ? "J'ai déjà un compte" : 'Créer un compte'}
        onPress={() => {
          setMode(isSignUp ? 'sign-in' : 'sign-up');
          setError(null);
        }}
      />
    </Screen>
  );
}
