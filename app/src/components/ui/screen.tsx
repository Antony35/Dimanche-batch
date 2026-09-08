import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

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
