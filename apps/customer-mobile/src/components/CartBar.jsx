import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { cartSelectors, useCart } from '../state/cart';
import { colors, radius, shadow, spacing, touchTarget } from '../theme/tokens';
import { Price, Text } from './ui';

/** Floating summary shown while the cart has items; opens the cart. */
export function CartBar({ bottomOffset = 0 }) {
  const count = useCart(cartSelectors.count);
  const subtotal = useCart(cartSelectors.subtotalKobo);
  const restaurant = useCart((s) => s.restaurant);
  const insets = useSafeAreaInsets();
  if (!count) return null;
  return (
    <View style={[styles.wrap, { bottom: bottomOffset + Math.max(insets.bottom, spacing.md) }]} pointerEvents="box-none">
      <Pressable
        testID="cart-bar"
        accessibilityRole="button"
        accessibilityLabel={`View cart, ${count} items from ${restaurant?.name}`}
        onPress={() => router.push('/cart')}
        style={({ pressed }) => [styles.bar, pressed && { opacity: 0.9 }]}
      >
        <View style={styles.count}>
          <Text variant="label" tone="primary">
            {count}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" tone="inverse">
            View cart
          </Text>
          <Text variant="caption" tone="inverse" numberOfLines={1}>
            {restaurant?.name}
          </Text>
        </View>
        <Price kobo={subtotal} tone="inverse" />
        <Ionicons name="chevron-forward" size={18} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 640,
    minHeight: touchTarget + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    ...shadow.card,
  },
  count: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
