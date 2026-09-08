import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { useHousehold } from '@/features/household/api/use-household';
import { queryClient } from '@/lib/query-client';
import { LoadingState, Screen } from '@/components/ui';
import { useTheme } from '@/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Navigation pilotée par l'état, pas par des redirections impératives.
 *
 * `Stack.Protected` retire du navigateur les écrans dont la condition est
 * fausse : impossible d'atteindre le planning sans foyer, ou l'onboarding une
 * fois le foyer rejoint, même via un lien profond.
 */
function RootNavigator() {
  const { user, isInitializing } = useAuth();
  const { household, isLoading } = useHousehold();
  const theme = useTheme();

  // Tant que la session persistée n'est pas restaurée, afficher l'écran de
  // connexion ferait clignoter l'app à chaque démarrage.
  if (isInitializing || (user && isLoading)) {
    return (
      <Screen>
        <LoadingState label="Ouverture…" />
      </Screen>
    );
  }

  const screenOptions = {
    headerStyle: { backgroundColor: theme.colors.bg },
    headerTintColor: theme.colors.ink,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: theme.colors.bg },
  } as const;

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack screenOptions={screenOptions}>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>

        <Stack.Protected guard={Boolean(user) && !household}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>

        <Stack.Protected guard={Boolean(user) && Boolean(household)}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="recette/[id]"
            options={{ title: 'Recette', presentation: 'card' }}
          />
        </Stack.Protected>
      </Stack>
    </>
  );
}
