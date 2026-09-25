import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { databaseLabel, isProduction } from '@/lib/env';
import { useTheme } from '@/theme';
import { Text } from './text';

export interface ScreenProps {
  children: ReactNode;
  /** Enveloppe le contenu dans un ScrollView. Faux pour les écrans à liste. */
  scroll?: boolean;
  contentStyle?: ViewStyle;
  /**
   * Vrai pour un écran d'onglet : la barre d'onglets protège déjà le bas de
   * l'écran, ajouter la marge du système la doublerait.
   */
  withTabBar?: boolean;
}

/**
 * Conteneur d'écran : fond du thème, zones sûres, marge horizontale unique.
 *
 * Deux protections qui ne font rien quand elles ne servent pas, et c'est
 * voulu : l'app doit rester identique sur un téléphone où tout tient déjà.
 *
 * - **Le bas de l'écran.** Android dessine l'app sous la barre de navigation.
 *   Avec la navigation par gestes, cette barre est fine et l'on ne voyait rien ;
 *   avec les trois boutons, elle masquait le bas des écrans hors onglets. La
 *   marge vaut exactement la hauteur de cette barre, donc presque rien avec les
 *   gestes.
 * - **Le clavier.** En plein écran, la fenêtre ne se réduit plus quand le
 *   clavier s'ouvre : il recouvrait le champ du mot de passe, sans qu'on puisse
 *   faire défiler. `KeyboardAvoidingView` réserve la place du clavier, et
 *   n'agit que lorsqu'il est ouvert.
 */
export function Screen({ children, scroll = true, contentStyle, withTabBar = false }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xl + (withTabBar ? 0 : insets.bottom),
    gap: theme.spacing.lg,
  };

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
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
