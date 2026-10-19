import { useEffect } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { LiveStatusContext, registerForPush, useNotificationTaps, useRealtime } from '../lib/live';
import { useAuth } from '../state/auth';

/**
 * Signed-in customers get live order updates (the order screen refetches when the API says it
 * changed) and push notifications; tapping one opens the order.
 */
export function LiveUpdates({ children }) {
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const live = useRealtime((e) => {
    if (e.type === 'order.updated' || e.type === 'delivery.updated') queryClient.invalidateQueries({ queryKey: ['orders'] });
    if (e.type === 'notification.new') queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }, isSignedIn);
  useEffect(() => {
    if (isSignedIn) void registerForPush();
  }, [isSignedIn]);
  useNotificationTaps((data) => {
    if (typeof data.orderId === 'string') router.push(`/orders/${data.orderId}`);
    else router.push('/notifications');
  });
  return <LiveStatusContext.Provider value={live}>{children}</LiveStatusContext.Provider>;
}
