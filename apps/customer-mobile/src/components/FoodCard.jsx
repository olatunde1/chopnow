import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, shadow, spacing } from '../theme/tokens';
import { FoodImage, Price, StatusBadge, Text } from './ui';
import { RestaurantMeta, availabilityBadge } from './RestaurantCard';

/** A food-first search result: the dish, its price, and the restaurant it comes from. */
export function FoodCard({ result, onPress }) {
  const { item, restaurant, orderable } = result;
  const status = !item.isAvailable ? { label: 'Sold out', tone: 'danger', icon: 'close-circle-outline' } : availabilityBadge(restaurant);
  return (
    <Pressable
      testID={`food-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} from ${restaurant.name}${orderable ? '' : `, ${status.label}`}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, !orderable && styles.dimmed, pressed && { opacity: 0.9 }]}
    >
      <FoodImage uri={item.imageUrl} name={item.name} size={88} rounded={radius.md} />
      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {item.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {restaurant.name} · {item.categoryName}
        </Text>
        <View style={styles.priceRow}>
          <Price kobo={item.fromPriceKobo} prefix={item.hasVariants ? 'from' : undefined} tone="primary" />
          {!orderable ? <StatusBadge {...status} /> : null}
        </View>
        <RestaurantMeta restaurant={restaurant} compact />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  dimmed: { opacity: 0.7 },
  body: { flex: 1, gap: 3, minWidth: 0 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});
