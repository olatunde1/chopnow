import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSkeleton, Chip, EmptyState, ErrorState, Price, Screen, StatusBadge, Text } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/hooks';
import { paymentLabel, statusLabel, statusTone } from '../../lib/orders';
import { useAuth } from '../../state/auth';
import { colors, radius, shadow, spacing } from '../../theme/tokens';

function OrderCard({ order: o }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${o.code} from ${o.restaurant.name}, ${statusLabel(o.status)}`}
      onPress={() => router.push(`/orders/${o.id}`)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.cardTop}>
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {o.restaurant.name}
        </Text>
        <Price kobo={o.totalKobo} />
      </View>
      <Text variant="caption" tone="muted">
        {o.code} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · {new Date(o.placedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
      </Text>
      <View style={styles.badges}>
        <StatusBadge label={statusLabel(o.status)} tone={statusTone(o.status)} />
        <StatusBadge label={paymentLabel(o)} tone="neutral" />
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
      </View>
    </Pressable>
  );
}

export default function OrdersScreen() {
  const { isSignedIn, status } = useAuth();
  const [filter, setFilter] = useState('active');
  const orders = useQuery({
    queryKey: ['orders', 'list', filter],
    queryFn: () => api.orders.list({ status: filter, pageSize: 50 }),
    enabled: isSignedIn,
    refetchInterval: filter === 'active' ? 15_000 : false,
  });

  if (status === 'restoring') return <Screen />;
  if (!isSignedIn) {
    return (
      <Screen>
        <EmptyState icon="receipt-outline" title="Your orders live here" message="Sign in to place and track orders." actionLabel="Sign in" onAction={() => router.push('/sign-in')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={orders.data?.items ?? []}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => <OrderCard order={item} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="title">Orders</Text>
            <View style={styles.badges}>
              <Chip label="In progress" selected={filter === 'active'} onPress={() => setFilter('active')} />
              <Chip label="Past orders" selected={filter === 'past'} onPress={() => setFilter('past')} />
            </View>
          </View>
        }
        ListEmptyComponent={
          orders.isPending ? (
            <CardSkeleton />
          ) : orders.isError ? (
            <ErrorState message={errorMessage(orders.error)} onRetry={orders.refetch} />
          ) : (
            <EmptyState
              icon="restaurant-outline"
              title={filter === 'active' ? 'No orders in progress' : 'No past orders yet'}
              message="When you place an order, you can track it here."
              actionLabel="Find food"
              onAction={() => router.push('/search')}
            />
          )
        }
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={orders.refetch} tintColor={colors.primary} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg },
  header: { gap: spacing.md, marginBottom: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, marginBottom: spacing.md, ...shadow.card },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
});
