import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { databaseLabel, isProduction } from '@/lib/env';
import { useTheme } from '@/theme';
import { Text } from './text';

export interface ScreenProps {
  children: ReactNode;
  /** Enveloppe le contenu dans un ScrollView. Faux pour les écrans à liste. */
  scroll?: boolean;
  contentStyle?: ViewStyle;
}

/** Conteneur d'écran : fond du thème, zones sûres, marge horizontale unique. */
export function Screen({ children, scroll = true, contentStyle }: ScreenProps) {
  const theme = useTheme();
  const padding = { padding: theme.spacing.xl, gap: theme.spacing.lg };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      {isProduction ? null : (
        // Sur chaque écran, pas seulement à l'accueil : on teste souvent depuis
        // un écran profond, et c'est là qu'on oublierait où l'on écrit.
        <View
          accessibilityRole="text"
          style={{ backgroundColor: theme.colors.spiceSoft, paddingVertical: theme.spacing.xs }}
        >
          <Text variant="overline" style={{ color: theme.colors.spiceInk, textAlign: 'center' }}>
            BASE DE TEST · {databaseLabel}
          </Text>
        </View>
      )}
      {scroll ? (
        <ScrollView
          contentContainerStyle={[padding, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, padding, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
