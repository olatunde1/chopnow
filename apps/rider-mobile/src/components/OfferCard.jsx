import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, StatusBadge, Text } from './ui';
import { distanceLabel, money, secondsLeft } from '../lib/delivery';
import { colors, radius, shadow, spacing } from '../theme/tokens';

/** Live countdown to the offer's expiry. */
export function useSecondsLeft(expiresAt) {
  const [left, setLeft] = useState(() => secondsLeft(expiresAt));
  useEffect(() => {
    setLeft(secondsLeft(expiresAt));
    const t = setInterval(() => setLeft(secondsLeft(expiresAt)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}

/**
 * A delivery offer. Shows only what a rider needs to decide: where to collect, the drop-off area,
 * distances, earning and cash to collect. The full address appears after accepting.
 */
export function OfferCard({ offer, onAccept, onDecline, busy }) {
  const left = useSecondsLeft(offer.expiresAt);
  const toShop = distanceLabel(offer.distanceToRestaurantMeters);
  const trip = distanceLabel(offer.deliveryDistanceMeters);
  return (
    <View style={styles.card} accessibilityLabel={`New delivery offer, ${left} seconds left`} testID="offer-card">
      <View style={styles.row}>
        <Text variant="heading" style={{ flex: 1 }}>
          New delivery
        </Text>
        <View style={[styles.timer, left <= 10 && styles.timerUrgent]} accessibilityLiveRegion="polite">
          <Ionicons name="timer-outline" size={16} color={left <= 10 ? colors.danger : colors.warning} />
          <Text variant="bodyStrong" tone={left <= 10 ? 'danger' : 'default'} testID="offer-seconds">
            {left}s
          </Text>
        </View>
      </View>

      <Text variant="display" testID="offer-earning">
        {money(offer.earningKobo)}
      </Text>
      <Text tone="muted">You earn for this delivery</Text>

      <View style={styles.leg}>
        <Ionicons name="restaurant-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{offer.restaurant.name}</Text>
          <Text tone="muted">
            {offer.restaurant.area}
            {toShop ? ` · ${toShop} from you` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.leg}>
        <Ionicons name="location-outline" size={20} color={colors.info} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">Drop-off in {offer.dropoffArea}</Text>
          <Text tone="muted">{trip ? `${trip} from the restaurant` : 'Distance unknown'} · {offer.itemCount} {offer.itemCount === 1 ? 'item' : 'items'}</Text>
        </View>
      </View>

      {offer.cashToCollectKobo > 0 ? (
        <StatusBadge label={`Collect ${money(offer.cashToCollectKobo)} cash`} tone="warning" icon="cash-outline" />
      ) : (
        <StatusBadge label="Paid online: no cash" tone="success" icon="card-outline" />
      )}

      <View style={styles.actions}>
        <Button title="Decline" variant="outline" onPress={onDecline} disabled={busy || left === 0} style={{ flex: 1 }} testID="decline-offer" />
        <Button title="Accept" icon="checkmark" onPress={onAccept} loading={busy} disabled={left === 0} style={{ flex: 2 }} testID="accept-offer" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 2, borderColor: colors.primary, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.warningSoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  timerUrgent: { backgroundColor: colors.dangerSoft },
  leg: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
