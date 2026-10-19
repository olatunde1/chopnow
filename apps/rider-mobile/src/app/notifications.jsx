import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, CardSkeleton, EmptyState, ErrorState, Screen, Text } from '../components/ui';
import { errorMessage } from '../lib/hooks';
import { notificationsApi } from '../lib/live';
import { colors, radius, spacing } from '../theme/tokens';

const when = (iso) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

/** Recent notifications (offers, job changes, cash and payout updates, approval decisions). */
export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list });
  const read = async (body) => {
    await notificationsApi.read(body).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  if (q.isPending) return <Screen edges={[]}><View style={{ padding: spacing.lg }}><CardSkeleton /></View></Screen>;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={q.refetch} />;
  return (
    <Screen edges={[]}>
      <FlatList
        contentContainerStyle={styles.content}
        data={q.data.items}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
        ListHeaderComponent={q.data.unreadCount ? <Button title={`Mark all ${q.data.unreadCount} as read`} variant="ghost" onPress={() => read({ all: true })} /> : null}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (!item.readAt) void read({ ids: [item.id] });
              if (item.type.startsWith('delivery.') || item.type.startsWith('cash.')) router.navigate(item.type.startsWith('cash.') ? '/earnings' : '/');
            }}
            style={[styles.card, !item.readAt && styles.unread]}
          >
            <Ionicons name={item.readAt ? 'notifications-outline' : 'notifications'} size={20} color={item.readAt ? colors.textMuted : colors.primary} />
            <View style={{ flex: 1, gap: spacing.xxs }}>
              <Text variant="bodyStrong">{item.title}</Text>
              <Text tone="muted">{item.body}</Text>
              <Text variant="caption" tone="muted">{when(item.createdAt)}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<EmptyState icon="notifications-off-outline" title="No notifications yet" />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
  card: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  unread: { backgroundColor: colors.primarySoft },
});
