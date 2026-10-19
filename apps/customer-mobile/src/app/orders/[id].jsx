import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ReviewForm } from '../../components/ReviewForm';
import { Button, CardSkeleton, ConfirmDialog, EmptyState, ErrorState, Price, StatusBadge, Text, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/hooks';
import { ORDER_STEPS, isTerminal, paymentLabel, riderLine, statusLabel, statusTone } from '../../lib/orders';
import { useLiveStatus } from '../../lib/live';
import { payForOrder } from '../../lib/payment-flow';
import { useCart } from '../../state/cart';
import { colors, radius, spacing } from '../../theme/tokens';

const time = (iso) => new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

function Timeline({ order }) {
  const reached = new Map(order.timeline.map((t) => [t.status, t.at]));
  const ended = order.status === 'CANCELLED' || order.status === 'REJECTED';
  const steps = ended ? [...ORDER_STEPS.filter((s) => reached.has(s)), order.status] : ORDER_STEPS;
  const currentIndex = steps.indexOf(order.status);
  return (
    <View style={styles.timeline} accessibilityLabel={`Order status: ${statusLabel(order.status)}`}>
      {steps.map((s, i) => {
        const done = reached.has(s);
        const current = i === currentIndex;
        const color = ended && current ? colors.danger : done ? colors.success : colors.border;
        return (
          <View key={s} style={styles.step}>
            <View style={styles.stepRail}>
              <View style={[styles.dot, { backgroundColor: color }]}>{done ? <Ionicons name={ended && current ? 'close' : 'checkmark'} size={12} color={colors.textInverse} /> : null}</View>
              {i < steps.length - 1 ? <View style={[styles.rail, { backgroundColor: reached.has(steps[i + 1]) ? colors.success : colors.border }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: spacing.md }}>
              <Text variant={current ? 'bodyStrong' : 'body'} tone={done ? 'default' : 'muted'}>
                {statusLabel(s)}
              </Text>
              {done ? (
                <Text variant="caption" tone="muted">
                  {time(reached.get(s))}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Order tracking. Updates live over the realtime socket, with polling as a fallback. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams();
  const live = useLiveStatus();
  const toast = useToast();
  const queryClient = useQueryClient();
  const replaceWith = useCart((s) => s.replaceWith);
  const addLine = useCart((s) => s.addLine);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(null);

  const order = useQuery({
    queryKey: ['orders', id],
    queryFn: () => api.orders.get(id),
    // Live updates refetch at once; polling is the fallback (slower while connected).
    refetchInterval: (q) => (q.state.data && isTerminal(q.state.data.status) && q.state.data.paymentStatus !== 'PENDING' ? false : live === 'open' ? 60_000 : 10_000),
  });

  if (order.isPending) {
    return (
      <View style={styles.pad}>
        <CardSkeleton />
      </View>
    );
  }
  if (order.isError) {
    return order.error?.status === 404 ? (
      <EmptyState icon="receipt-outline" title="Order not found" actionLabel="My orders" onAction={() => router.replace('/orders')} />
    ) : (
      <ErrorState message={errorMessage(order.error)} onRetry={order.refetch} />
    );
  }
  const o = order.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orders'] });

  const pay = async () => {
    setBusy('pay');
    try {
      const { result } = await payForOrder(o.id);
      toast.show(result.message, result.status === 'SUCCESSFUL' ? 'success' : 'info');
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const checkPayment = async () => {
    if (!o.payment) return;
    setBusy('verify');
    try {
      const result = await api.orders.verifyPayment(o.payment.reference);
      toast.show(result.message, result.status === 'SUCCESSFUL' ? 'success' : 'info');
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const cancel = async () => {
    setConfirmCancel(false);
    setBusy('cancel');
    try {
      await api.orders.cancel(o.id);
      toast.show(o.paymentStatus === 'SUCCESSFUL' ? 'Order cancelled. Your refund is being processed.' : 'Order cancelled.', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const reorder = async () => {
    setBusy('reorder');
    try {
      const preview = await api.orders.reorder(o.id);
      if (!preview.lines.length) {
        toast.show('None of these items are available right now.', 'danger');
        return;
      }
      const ref = { id: preview.restaurant.id, slug: preview.restaurant.slug, name: preview.restaurant.name, minOrderKobo: preview.restaurant.minOrderKobo };
      preview.lines.forEach((l, i) => {
        const line = { ...l, extras: l.extras, instructions: l.instructions ?? undefined };
        // Reordering replaces whatever is in the cart.
        if (i === 0) replaceWith(ref, line);
        else addLine(ref, line);
      });
      toast.show(preview.unavailable.length ? `Added to cart. ${preview.unavailable.length} item(s) are unavailable.` : 'Added to cart at today’s prices.', 'success');
      router.push('/cart');
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const showPin = !isTerminal(o.status) && o.sentToRestaurant;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Stack.Screen options={{ title: `Order ${o.code}` }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={order.isRefetching} onRefresh={order.refetch} tintColor={colors.primary} />}>
        <View style={styles.header}>
          <Text variant="title" numberOfLines={2}>
            {o.restaurant.name}
          </Text>
          <View style={styles.badges}>
            <StatusBadge label={statusLabel(o.status)} tone={statusTone(o.status)} />
            <StatusBadge label={paymentLabel(o)} tone={o.paymentStatus === 'SUCCESSFUL' ? 'success' : o.paymentStatus === 'FAILED' ? 'danger' : 'neutral'} icon={o.paymentMethod === 'ONLINE' ? 'card-outline' : 'cash-outline'} />
            {o.payment?.isTestPayment ? <StatusBadge label="Test payment" tone="warning" icon="flask-outline" /> : null}
          </View>
          {o.cancellationReason ? <Text tone="muted">Reason: {o.cancellationReason}</Text> : null}
        </View>

        {o.paymentMethod === 'ONLINE' && !o.sentToRestaurant && o.status === 'PLACED' ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Ionicons name="time-outline" size={20} color={colors.warning} />
            <Text variant="caption" style={{ flex: 1 }}>
              Your order is sent to the restaurant as soon as payment is confirmed.
            </Text>
          </View>
        ) : null}

        {o.canPay ? (
          <View style={{ gap: spacing.sm }}>
            <Button title={`Pay ${o.paymentStatus === 'FAILED' ? 'again' : 'now'}`} icon="card" onPress={pay} loading={busy === 'pay'} fullWidth testID="pay-now" />
            {o.payment ? <Button title="I’ve paid, check status" variant="outline" onPress={checkPayment} loading={busy === 'verify'} fullWidth testID="check-payment" /> : null}
          </View>
        ) : null}

        {showPin ? (
          <View style={styles.pinCard} accessibilityLabel={`Delivery PIN ${o.deliveryPin.split('').join(' ')}`}>
            <Text variant="label" tone="inverse">
              DELIVERY PIN
            </Text>
            <Text style={styles.pin} tone="inverse" testID="delivery-pin">
              {o.deliveryPin}
            </Text>
            <Text variant="caption" tone="inverse">
              Share this only with your rider when your food arrives.
            </Text>
          </View>
        ) : null}

        {o.estimatedReadyAt && ['ACCEPTED', 'PREPARING'].includes(o.status) ? (
          <View style={styles.readyNote} testID="ready-estimate">
            <Ionicons name="restaurant-outline" size={20} color={colors.info} />
            <Text style={{ flex: 1 }}>
              Food expected ready around <Text variant="bodyStrong">{time(o.estimatedReadyAt)}</Text>
            </Text>
          </View>
        ) : null}

        {o.rider && !isTerminal(o.status) ? (
          <View style={styles.readyNote} testID="rider-card">
            <Ionicons name={o.rider.vehicleType === 'BICYCLE' ? 'bicycle-outline' : o.rider.vehicleType === 'CAR' ? 'car-outline' : 'bicycle'} size={20} color={colors.info} />
            <Text style={{ flex: 1 }}>
              <Text variant="bodyStrong">{o.rider.firstName}</Text> {riderLine(o.deliveryStatus)}
            </Text>
          </View>
        ) : o.deliveryStatus === 'OFFERING' && !isTerminal(o.status) ? (
          <Text tone="muted" testID="finding-rider">
            Finding a rider for your order…
          </Text>
        ) : null}

        {o.canReview ? (
          <ReviewForm
            riderName={o.rider?.firstName}
            restaurantName={o.restaurant.name}
            onSubmit={async (input) => {
              await api.orders.review(o.id, input);
              toast.show('Thanks for your review!', 'success');
              refresh();
            }}
          />
        ) : null}

        <View style={styles.card}>
          <Text variant="heading">Progress</Text>
          <Timeline order={o} />
        </View>

        <View style={styles.card}>
          <Text variant="heading">Items</Text>
          {o.items.map((i) => (
            <View key={i.id} style={styles.itemRow}>
              <Text variant="bodyStrong">{i.quantity}×</Text>
              <View style={{ flex: 1 }}>
                <Text>{i.name}</Text>
                {i.variantName || i.extras.length ? (
                  <Text variant="caption" tone="muted">
                    {[i.variantName, ...i.extras.map((e) => (e.quantity > 1 ? `${e.quantity} × ${e.name}` : e.name))].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <Price kobo={i.lineTotalKobo} variant="body" />
            </View>
          ))}
          <View style={styles.divider} />
          {[
            ['Food', o.subtotalKobo],
            ['Delivery', o.deliveryFeeKobo],
            ['Service fee', o.serviceFeeKobo],
            ...(o.discountKobo ? [['Discount', -o.discountKobo]] : []),
          ].map(([label, kobo]) => (
            <View key={label} style={styles.totalRow}>
              <Text tone="muted">{label}</Text>
              <Price kobo={kobo} variant="body" tone="muted" />
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text variant="heading">Total</Text>
            <Price kobo={o.totalKobo} variant="heading" />
          </View>
        </View>

        <View style={styles.card}>
          <Text variant="heading">Delivery address</Text>
          <Text>
            {o.deliveryAddress.label}: {[o.deliveryAddress.line1, o.deliveryAddress.area, o.deliveryAddress.city].filter(Boolean).join(', ')}
          </Text>
          {o.customerNote ? <Text tone="muted">Note: {o.customerNote}</Text> : null}
        </View>

        {o.canCancel ? <Button title="Cancel order" variant="outline" icon="close-circle-outline" onPress={() => setConfirmCancel(true)} loading={busy === 'cancel'} fullWidth testID="cancel-order" /> : null}
        {isTerminal(o.status) ? <Button title="Order again" variant="secondary" icon="refresh" onPress={reorder} loading={busy === 'reorder'} fullWidth /> : null}
      </ScrollView>
      <ConfirmDialog
        visible={confirmCancel}
        title="Cancel this order?"
        message={o.paymentStatus === 'SUCCESSFUL' ? 'You’ve already paid. We’ll start a full refund.' : 'The restaurant hasn’t accepted it yet, so there’s no charge.'}
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        destructive
        onCancel={() => setConfirmCancel(false)}
        onConfirm={cancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: spacing.xxl },
  header: { gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  readyNote: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft },
  notice: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  pinCard: { backgroundColor: colors.text, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', gap: spacing.xs },
  pin: { fontSize: 40, lineHeight: 48, fontWeight: '800', letterSpacing: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  timeline: { marginTop: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.md },
  stepRail: { alignItems: 'center', width: 20 },
  dot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rail: { width: 2, flex: 1, minHeight: 16 },
  itemRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
