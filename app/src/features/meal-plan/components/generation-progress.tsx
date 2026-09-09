import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { GenerationLock, GenerationStep } from '@dimanche-batch/shared';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Ce que fait le serveur, pendant qu'on attend.
 *
 * Les libellés vivent ici et pas en base : le document de progression ne porte
 * qu'un code d'étape, précisément pour qu'aucun texte venu du serveur ne
 * s'affiche tel quel.
 */
const STEP_LABELS: Record<GenerationStep, string> = {
  preparing: 'Relecture des semaines passées et de tes favoris',
  generating: 'Le modèle compose la semaine',
  retrying: 'La première proposition ne tenait pas les contraintes — nouvel essai',
  writing: 'Enregistrement du plan et de la liste de courses',
};

export interface GenerationProgressProps {
  lock: GenerationLock | null;
  /** Affiché tant que le serveur n'a pas encore publié d'étape. */
  fallbackLabel?: string;
}

export function GenerationProgress({
  lock,
  fallbackLabel = 'Envoi de la demande',
}: GenerationProgressProps) {
  const theme = useTheme();
  const elapsed = useElapsedSeconds(lock?.startedAt ?? null);

  const label = lock ? STEP_LABELS[lock.step] : fallbackLabel;
  const isRetry = lock?.step === 'retrying';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        backgroundColor: isRetry ? theme.colors.spiceSoft : theme.colors.accentSoft,
        borderRadius: theme.radius.md,
      }}
    >
      <ActivityIndicator color={isRetry ? theme.colors.spice : theme.colors.accent} />

      <View style={{ flex: 1, gap: 2 }}>
        <Text
          variant="caption"
          style={{ color: isRetry ? theme.colors.spiceInk : theme.colors.accent }}
        >
          {label}
        </Text>
        <Text variant="caption" tone="faint">
          {elapsed === null ? 'Cela prend environ une minute.' : formatElapsed(elapsed)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Secondes écoulées depuis le début côté serveur.
 *
 * Compté à partir de `startedAt` et non du moment où l'écran a monté : c'est la
 * durée réelle de la génération, y compris si elle a été lancée depuis l'autre
 * téléphone.
 */
function useElapsedSeconds(startedAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (startedAt === null) return null;
  return Math.max(0, Math.round((now - startedAt) / 1000));
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} s — environ une minute en tout`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} min ${String(rest).padStart(2, '0')}`;
}
