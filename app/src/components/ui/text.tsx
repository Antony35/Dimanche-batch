import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme, type TypographyVariant } from '@/theme';

type Tone = 'default' | 'soft' | 'faint' | 'accent' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: Tone;
}

/**
 * Seul composant texte de l'app. Impose l'échelle typographique et les tons du
 * thème plutôt que des tailles et couleurs choisies écran par écran.
 */
export function Text({ variant = 'body', tone = 'default', style, ...props }: TextProps) {
  const theme = useTheme();

  const toneColor: Record<Tone, string> = {
    default: theme.colors.ink,
    soft: theme.colors.inkSoft,
    faint: theme.colors.inkFaint,
    accent: theme.colors.accent,
    danger: theme.colors.danger,
  };

  return (
    <RNText
      style={[theme.typography[variant] as TextStyle, { color: toneColor[tone] }, style]}
      {...props}
    />
  );
}
