import { useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui';
import { ApiError } from '../lib/api-client';
import { AuthProvider } from '../state/auth';
import { colors } from '../theme/tokens';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // Retry network blips, not 4xx responses (those will not change by retrying).
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <StatusBar style="dark" />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: colors.cream },
                  headerTintColor: colors.text,
                  headerTitleStyle: { fontWeight: '700' },
                  headerShadowVisible: false,
                  contentStyle: { backgroundColor: colors.cream },
                  headerBackButtonDisplayMode: 'minimal',
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerBackVisible: false }} />
                <Stack.Screen name="sign-up" options={{ title: 'Become a rider' }} />
                <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
              </Stack>
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
