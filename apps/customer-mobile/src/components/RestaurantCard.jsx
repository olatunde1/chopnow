import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, shadow, spacing } from '../theme/tokens';
import { FoodImage, Price, StatusBadge, Text } from './ui';

export function formatDistance(m) {
  if (m === null || m === undefined) return null;
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Availability label. A restaurant is never shown as open for orders unless the API says it is. */
export function availabilityBadge(r) {
  if (r.isAcceptingOrders) return { label: 'Open', tone: 'success', icon: 'ellipse' };
  if (r.deliversToLocation === false) return { label: 'Out of range', tone: 'neutral', icon: 'navigate-outline' };
  if (!r.isOpenNow) return { label: 'Closed now', tone: 'neutral', icon: 'moon-outline' };
  return { label: 'Not taking orders', tone: 'warning', icon: 'pause-circle-outline' };
}

export function RestaurantMeta({ restaurant: r, compact = false }) {
  const distance = formatDistance(r.distanceMeters);
  return (
    <View style={styles.meta}>
      {r.ratingAverage ? (
        <View style={styles.metaItem}>
          <Ionicons name="star" size={13} color={colors.warning} />
          <Text variant="caption">
            {r.ratingAverage.toFixed(1)} ({r.ratingCount})
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="muted">
          New
        </Text>
      )}
      <View style={styles.metaItem}>
        <Ionicons name="time-outline" size={13} color={colors.textMuted} />
        <Text variant="caption" tone="muted">
          {r.prepTimeMinutes} min
        </Text>
      </View>
      {distance ? (
        <Text variant="caption" tone="muted">
          {distance}
        </Text>
      ) : null}
      {!compact && r.deliveryFeeKobo !== null ? (
        <View style={styles.metaItem}>
          <Ionicons name="bicycle-outline" size={13} color={colors.textMuted} />
          <Price kobo={r.deliveryFeeKobo} variant="caption" tone="muted" />
        </View>
      ) : null}
    </View>
  );
}

export function RestaurantCard({ restaurant: r, onPress }) {
  const badge = availabilityBadge(r);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.name}, ${badge.label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, !r.isAcceptingOrders && styles.dimmed, pressed && styles.pressed]}
    >
      <FoodImage uri={r.coverImageUrl ?? r.logoUrl} name={r.name} height={128} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {r.name}
          </Text>
          {r.isFavourite ? <Ionicons name="heart" size={18} color={colors.primary} accessibilityLabel="Favourite" /> : null}
        </View>
        <StatusBadge {...badge} />
        <RestaurantMeta restaurant={r} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.lg, ...shadow.card },
  dimmed: { opacity: 0.75 },
  pressed: { opacity: 0.9 },
  body: { padding: spacing.md, gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: spacing.xs },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
