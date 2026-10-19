import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMinor } from '@chopnow/shared-utils';
import { Button, ConfirmDialog, EmptyState, Price, QuantityStepper, Screen, Text } from '../components/ui';
import { useAuth } from '../state/auth';
import { MAX_LINE_QUANTITY, cartSelectors, useCart } from '../state/cart';
import { colors, radius, spacing, touchTarget } from '../theme/tokens';

function lineDescription(line) {
  const parts = [];
  if (line.variantName) parts.push(line.variantName);
  for (const e of line.extras) parts.push(e.quantity > 1 ? `${e.quantity} × ${e.name}` : e.name);
  return parts.join(' · ');
}

/**
 * Cart review: change quantities, remove lines, clear, continue to checkout. Prices shown are from
 * the menu when items were added; checkout asks the server for the real total.
 */
export default function CartScreen() {
  const { isSignedIn } = useAuth();
  const { restaurant, lines, setQuantity, removeLine, clear } = useCart();
  const subtotal = useCart(cartSelectors.subtotalKobo);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!lines.length) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="bag-handle-outline" title="Your cart is empty" message="Find a dish you love and add it here." actionLabel="Find food" onAction={() => router.replace('/search')} />
      </Screen>
    );
  }

  const belowMinimum = restaurant?.minOrderKobo > 0 && subtotal < restaurant.minOrderKobo;

  return (
    <Screen edges={['bottom']}>
      <FlatList
        data={lines}
        keyExtractor={(l) => l.key}
        ListHeaderComponent={
          <Pressable accessibilityRole="link" onPress={() => router.push(`/restaurant/${restaurant.slug}`)} style={styles.restaurant}>
            <Ionicons name="storefront-outline" size={18} color={colors.primary} />
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {restaurant.name}
            </Text>
            <Text variant="caption" tone="primary">
              Add more
            </Text>
          </Pressable>
        }
        renderItem={({ item: line }) => (
          <View style={styles.line}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={2}>
                {line.name}
              </Text>
              {lineDescription(line) ? (
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {lineDescription(line)}
                </Text>
              ) : null}
              {line.instructions ? (
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  “{line.instructions}”
                </Text>
              ) : null}
              <Price kobo={line.unitPriceKobo * line.quantity} />
            </View>
            <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
              <QuantityStepper value={line.quantity} min={0} max={MAX_LINE_QUANTITY} onChange={(q) => setQuantity(line.key, q)} />
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${line.name}`} onPress={() => removeLine(line.key)} style={styles.remove}>
                <Text variant="caption" tone="danger">
                  Remove
                </Text>
              </Pressable>
            </View>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            <View style={styles.totalRow}>
              <Text variant="heading">Subtotal</Text>
              <Price kobo={subtotal} variant="heading" />
            </View>
            <Text variant="caption" tone="muted">
              Delivery and service fees are calculated at checkout, where prices and availability are confirmed.
            </Text>
            {belowMinimum ? (
              <Text variant="caption" tone="danger" accessibilityRole="alert">
                {restaurant.name} has a minimum order of {formatMinor(restaurant.minOrderKobo)}. Add {formatMinor(restaurant.minOrderKobo - subtotal)} more.
              </Text>
            ) : null}
            <Button
              title="Go to checkout"
              icon="arrow-forward"
              onPress={() => router.push(isSignedIn ? '/checkout' : '/sign-in')}
              disabled={belowMinimum}
              fullWidth
              testID="go-to-checkout"
            />
            {!isSignedIn ? (
              <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                You’ll be asked to sign in first. Your cart is kept.
              </Text>
            ) : null}
            <Button title="Clear cart" variant="ghost" icon="trash-outline" onPress={() => setConfirmClear(true)} />
          </View>
        }
        contentContainerStyle={styles.list}
      />
      <ConfirmDialog
        visible={confirmClear}
        title="Clear your cart?"
        message="All items will be removed."
        confirmLabel="Clear cart"
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          clear();
          setConfirmClear(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md },
  restaurant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    marginBottom: spacing.md,
  },
  line: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, marginBottom: spacing.md },
  remove: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm },
  footer: { gap: spacing.sm, marginTop: spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
