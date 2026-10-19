import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMinor } from '@chopnow/shared-utils';
import { Button, EmptyState, Price, Screen, Skeleton, StatusBadge, Text, useToast } from '../components/ui';
import { api } from '../lib/api';
import { errorMessage, useAddresses } from '../lib/hooks';
import { createIdempotencyTracker, toOrderItems } from '../lib/orders';
import { payForOrder } from '../lib/payment-flow';
import { useAuth } from '../state/auth';
import { cartSelectors, useCart } from '../state/cart';
import { useDeliveryLocation } from '../state/location';
import { colors, radius, spacing, touchTarget, typography } from '../theme/tokens';

function Choice({ icon, title, subtitle, selected, disabled, onPress, testID }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      aria-checked={selected} aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected, disabled && { opacity: 0.55 }]}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textMuted} />
    </Pressable>
  );
}

function Row({ label, kobo, strong, tone }) {
  return (
    <View style={styles.row}>
      <Text variant={strong ? 'heading' : 'body'} tone={tone}>
        {label}
      </Text>
      <Price kobo={kobo} variant={strong ? 'heading' : 'body'} tone={tone} />
    </View>
  );
}

export default function CheckoutScreen() {
  const { isSignedIn } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { restaurant, lines, clear } = useCart();
  const count = useCart(cartSelectors.count);
  const addresses = useAddresses();
  const location = useDeliveryLocation((s) => s.location);

  const defaultAddressId = useMemo(() => {
    const items = addresses.data?.items ?? [];
    return (location?.source === 'address' && items.find((a) => a.id === location.addressId)?.id) || items.find((a) => a.isDefault)?.id || items[0]?.id || null;
  }, [addresses.data, location]);
  const [addressId, setAddressId] = useState(null);
  const chosenAddressId = addressId ?? defaultAddressId;
  const [paymentMethod, setPaymentMethod] = useState('CASH_ON_DELIVERY');
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState(undefined);
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const tracker = useRef(createIdempotencyTracker()).current;

  const request = useMemo(
    () =>
      restaurant && chosenAddressId
        ? { restaurantId: restaurant.id, addressId: chosenAddressId, paymentMethod, items: toOrderItems(lines), ...(promoCode ? { promoCode } : {}), ...(note.trim() ? { customerNote: note.trim() } : {}) }
        : null,
    [restaurant, chosenAddressId, paymentMethod, lines, promoCode, note],
  );
  // The note doesn't affect price; leave it out of the quote key to avoid re-quoting on every keystroke.
  const { customerNote: _n, ...quoteInput } = request ?? {};
  const quote = useQuery({
    queryKey: ['quote', quoteInput],
    queryFn: () => api.orders.quote(quoteInput),
    enabled: !!request && isSignedIn,
    placeholderData: (prev) => prev,
  });

  if (!isSignedIn) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="person-circle-outline" title="Sign in to check out" message="Your cart is saved." actionLabel="Sign in" onAction={() => router.push('/sign-in')} />
      </Screen>
    );
  }
  if (!count) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="bag-handle-outline" title="Your cart is empty" actionLabel="Find food" onAction={() => router.replace('/search')} />
      </Screen>
    );
  }

  const q = quote.data;
  const problemsByLine = new Map((q?.problems ?? []).filter((p) => p.lineIndex !== undefined).map((p) => [p.lineIndex, p.message]));
  const generalProblems = (q?.problems ?? []).filter((p) => p.lineIndex === undefined);
  const canPlace = !!q?.canPlaceOrder && !quote.isFetching && !placing;

  const placeOrder = async () => {
    if (!request) return;
    setPlacing(true);
    let order;
    try {
      order = await api.orders.create(request, tracker.keyFor(request));
      tracker.settle(null);
    } catch (err) {
      tracker.settle(err);
      toast.show(errorMessage(err), 'danger');
      if (err.code === 'ORDER_NOT_PLACEABLE') quote.refetch();
      setPlacing(false);
      return;
    }
    clear();
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    router.replace(`/orders/${order.id}`);
    if (paymentMethod === 'ONLINE') {
      try {
        const { result } = await payForOrder(order.id);
        toast.show(result.message, result.status === 'SUCCESSFUL' ? 'success' : 'info');
      } catch (err) {
        toast.show(errorMessage(err), 'danger');
      } finally {
        queryClient.invalidateQueries({ queryKey: ['orders', order.id] });
      }
    } else {
      toast.show('Order placed. The restaurant will confirm shortly.', 'success');
    }
    setPlacing(false);
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text variant="heading">Deliver to</Text>
          {addresses.isPending ? (
            <Skeleton height={64} />
          ) : addresses.data?.items.length ? (
            addresses.data.items.map((a) => (
              <Choice
                key={a.id}
                icon="location-outline"
                title={a.label}
                subtitle={[a.line1, a.area].filter(Boolean).join(', ')}
                selected={a.id === chosenAddressId}
                onPress={() => setAddressId(a.id)}
              />
            ))
          ) : (
            <Text tone="muted">Add a delivery address to continue.</Text>
          )}
          <Button title="Add a new address" variant="ghost" icon="add" onPress={() => router.push('/address-form')} />
        </View>

        <View style={styles.section}>
          <Text variant="heading">Your order from {restaurant.name}</Text>
          {lines.map((l, i) => (
            <View key={l.key} style={[styles.line, problemsByLine.has(i) && styles.lineProblem]}>
              <Text variant="bodyStrong">{l.quantity}×</Text>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2}>{l.name}</Text>
                {l.variantName || l.extras.length ? (
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {[l.variantName, ...l.extras.map((e) => (e.quantity > 1 ? `${e.quantity} × ${e.name}` : e.name))].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {problemsByLine.has(i) ? (
                  <Text variant="caption" tone="danger">
                    {problemsByLine.get(i)}
                  </Text>
                ) : null}
              </View>
              <Price kobo={q?.lines[i]?.lineTotalKobo ?? l.unitPriceKobo * l.quantity} variant="body" />
            </View>
          ))}
          <Button title="Edit cart" variant="ghost" icon="create-outline" onPress={() => router.push('/cart')} />
        </View>

        <View style={styles.section}>
          <Text variant="heading">Payment</Text>
          <Choice
            testID="pay-cash"
            icon="cash-outline"
            title="Cash on delivery"
            subtitle={q && !q.cashOnDeliveryAllowed ? q.cashOnDeliveryReason : 'Pay the rider when your food arrives'}
            selected={paymentMethod === 'CASH_ON_DELIVERY'}
            disabled={!!q && !q.cashOnDeliveryAllowed && paymentMethod !== 'CASH_ON_DELIVERY'}
            onPress={() => setPaymentMethod('CASH_ON_DELIVERY')}
          />
          <Choice testID="pay-online" icon="card-outline" title="Pay online" subtitle="Card, bank transfer or USSD" selected={paymentMethod === 'ONLINE'} onPress={() => setPaymentMethod('ONLINE')} />
        </View>

        <View style={styles.section}>
          <Text variant="heading">Promo code</Text>
          <View style={styles.promoRow}>
            <TextInput
              value={promoInput}
              onChangeText={setPromoInput}
              placeholder="e.g. WELCOME10"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              style={styles.input}
              accessibilityLabel="Promo code"
              testID="promo-input"
            />
            {promoCode ? (
              <Button title="Remove" variant="outline" size="sm" onPress={() => { setPromoCode(undefined); setPromoInput(''); }} />
            ) : (
              <Button title="Apply" variant="secondary" size="sm" disabled={promoInput.trim().length < 3} onPress={() => setPromoCode(promoInput.trim().toUpperCase())} testID="promo-apply" />
            )}
          </View>
          {q?.promotion ? <StatusBadge label={`${q.promotion.code} applied`} tone="success" icon="pricetag" /> : null}
        </View>

        <View style={styles.section}>
          <Text variant="heading">Note for the restaurant</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Allergies, gate code…"
            placeholderTextColor={colors.textMuted}
            maxLength={300}
            multiline
            style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]}
            accessibilityLabel="Note for the restaurant"
          />
        </View>

        <View style={styles.summary}>
          {quote.isPending && !q ? (
            <Skeleton height={120} />
          ) : quote.isError ? (
            quote.error?.status === 404 ? (
              <View style={{ gap: spacing.sm }}>
                <Text tone="danger" accessibilityRole="alert">
                  This restaurant or address is no longer available. Start a new cart, or pick another address.
                </Text>
                <Button title="Clear cart and browse" variant="outline" onPress={() => { clear(); router.replace('/'); }} />
              </View>
            ) : (
              <Text tone="danger">{errorMessage(quote.error)}</Text>
            )
          ) : q ? (
            <>
              <Row label="Food" kobo={q.subtotalKobo} />
              <Row label={`Delivery (${(q.distanceMeters / 1000).toFixed(1)} km)`} kobo={q.deliveryFeeKobo} />
              <Row label="Service fee" kobo={q.serviceFeeKobo} />
              {q.discountKobo ? <Row label="Discount" kobo={-q.discountKobo} tone="primary" /> : null}
              <View style={styles.divider} />
              <Row label="Total" kobo={q.totalKobo} strong />
              {generalProblems.map((p) => (
                <Text key={p.code + p.message} variant="caption" tone="danger" accessibilityRole="alert">
                  {p.message}
                </Text>
              ))}
            </>
          ) : null}
        </View>

        <Button
          testID="place-order"
          title={q ? `${paymentMethod === 'ONLINE' ? 'Place order & pay' : 'Place order'} · ${formatMinor(q.totalKobo)}` : 'Place order'}
          onPress={placeOrder}
          loading={placing}
          disabled={!canPlace}
          fullWidth
        />
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          Prices and availability are confirmed by the restaurant’s current menu when you place the order.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 12,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  line: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  lineProblem: { borderWidth: 1.5, borderColor: colors.danger },
  promoRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: touchTarget,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.text,
  },
  summary: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
});
