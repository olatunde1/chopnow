import { useEffect } from 'react';
import { Redirect, Tabs, router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSkeleton, Screen } from '../../components/ui';
import { LiveStatusContext, registerForPush, useNotificationTaps, useRealtime } from '../../lib/live';
import { useAuth } from '../../state/auth';
import { colors } from '../../theme/tokens';

const icon = (name) =>
  function TabIcon({ color, focused, size }) {
    return <Ionicons name={focused ? name : `${name}-outline`} size={size} color={color} />;
  };

/** Every rider screen needs a signed-in rider; otherwise go to sign-in. */
export default function TabLayout() {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = status === 'signedIn';
  // Offers and job changes arrive over the socket; the work poll slows down while it's connected.
  const live = useRealtime((e) => {
    if (e.type === 'work.updated' || e.type === 'order.updated') queryClient.invalidateQueries({ queryKey: ['rider', 'work'] });
    if (e.type === 'notification.new') {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['rider', 'me'] });
    }
  }, signedIn);
  useEffect(() => {
    if (signedIn) void registerForPush();
  }, [signedIn]);
  useNotificationTaps(() => router.navigate('/'));
  if (status === 'restoring') {
    return (
      <Screen>
        <CardSkeleton />
      </Screen>
    );
  }
  if (status !== 'signedIn') return <Redirect href="/sign-in" />;
  return (
    <LiveStatusContext.Provider value={live}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 60 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Deliveries', tabBarIcon: icon('bicycle') }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings', tabBarIcon: icon('wallet') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person') }} />
    </Tabs>
    </LiveStatusContext.Provider>
  );
}
