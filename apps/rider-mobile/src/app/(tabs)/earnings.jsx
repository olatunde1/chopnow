import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CashHandInSheet, RemittanceRow, SettlementRow } from '../../components/CashHandIn';
import { Button, CardSkeleton, Chip, EmptyState, ErrorState, Screen, StatusBadge, Text, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { daysAgo, lagosToday, money } from '../../lib/delivery';
import { errorMessage } from '../../lib/hooks';
import { colors, radius, spacing } from '../../theme/tokens';

const RANGES = [
  ['Today', 0],
  ['7 days', 6],
  ['30 days', 29],
];
const STATUS = { DELIVERED: ['Delivered', 'success'], FAILED: ['Problem', 'danger'], CANCELLED: ['Cancelled', 'neutral'] };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '');

export default function EarningsScreen() {
  const [days, setDays] = useState(6);
  const today = lagosToday();
  const from = daysAgo(today, days);
  const earnings = useQuery({ queryKey: ['rider', 'earnings', from, today], queryFn: () => api.rider.earnings(from, today) });
  const history = useQuery({ queryKey: ['rider', 'history'], queryFn: () => api.rider.history(1) });
  const remittances = useQuery({ queryKey: ['rider', 'remittances'], queryFn: api.rider.remittances });
  const settlements = useQuery({ queryKey: ['rider', 'settlements'], queryFn: api.rider.settlements });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [handIn, setHandIn] = useState(false);
  const [sending, setSending] = useState(false);
  const [handInError, setHandInError] = useState(null);
  const awaiting = (remittances.data?.items ?? []).filter((r) => r.status === 'PENDING_CONFIRMATION').reduce((n, r) => n + r.amountKobo, 0);
  const available = Math.max(0, (earnings.data?.outstandingCashKobo ?? 0) - awaiting);

  const declare = async (amountKobo, reference) => {
    setSending(true);
    setHandInError(null);
    try {
      await api.rider.declareRemittance(amountKobo, reference);
      setHandIn(false);
      toast.show('Sent to finance. We’ll confirm it against the bank statement.', 'success');
      queryClient.invalidateQueries({ queryKey: ['rider'] });
    } catch (e) {
      setHandInError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const header = (
    <View style={{ gap: spacing.lg }}>
      <Text variant="title">Earnings</Text>
      <View style={styles.chips}>
        {RANGES.map(([label, n]) => (
          <Chip key={label} label={label} selected={days === n} onPress={() => setDays(n)} />
        ))}
      </View>
      {earnings.isPending ? (
        <CardSkeleton />
      ) : earnings.isError ? (
        <ErrorState message={errorMessage(earnings.error)} onRetry={earnings.refetch} />
      ) : (
        <View style={styles.cards}>
          <View style={styles.card}>
            <Text tone="muted">Earned</Text>
            <Text variant="title" testID="earned-total">
              {money(earnings.data.totalKobo)}
            </Text>
            <Text tone="muted">{earnings.data.deliveries} {earnings.data.deliveries === 1 ? 'delivery' : 'deliveries'}</Text>
          </View>
          <View style={styles.card}>
            <Text tone="muted">Not yet paid out</Text>
            <Text variant="title">{money(earnings.data.unsettledKobo)}</Text>
            <Text tone="muted">Paid at settlement</Text>
          </View>
          <View style={[styles.card, earnings.data.outstandingCashKobo > 0 && styles.cashCard]}>
            <Text tone="muted">Cash to hand in</Text>
            <Text variant="title" testID="cash-held">
              {money(earnings.data.outstandingCashKobo)}
            </Text>
            <Text tone="muted">Collected from customers</Text>
          </View>
        </View>
      )}
      {earnings.data && (earnings.data.outstandingCashKobo > 0 || remittances.data?.items.length) ? (
        <View style={styles.section}>
          <Text variant="heading">Cash hand-ins</Text>
          {awaiting > 0 ? <Text tone="muted">{money(awaiting)} awaiting confirmation by finance.</Text> : null}
          {available > 0 ? <Button title="I’ve transferred cash" icon="swap-horizontal" variant="secondary" onPress={() => setHandIn(true)} testID="open-handin" /> : null}
          {(remittances.data?.items ?? []).slice(0, 5).map((r) => (
            <RemittanceRow key={r.id} r={r} />
          ))}
        </View>
      ) : null}
      {settlements.data?.items.length ? (
        <View style={styles.section}>
          <Text variant="heading">Payouts</Text>
          {settlements.data.items.slice(0, 6).map((st) => (
            <SettlementRow key={st.id} s={st} />
          ))}
        </View>
      ) : null}
      <Text variant="heading">Recent deliveries</Text>
    </View>
  );

  return (
    <Screen>
      <FlatList
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        data={history.data?.items ?? []}
        keyExtractor={(d) => d.id}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => {
          const [label, tone] = STATUS[item.status] ?? [item.status, 'neutral'];
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">
                  {item.restaurantName} → {item.dropoffArea}
                </Text>
                <Text tone="muted">
                  {item.orderCode} · {when(item.deliveredAt ?? item.assignedAt)}
                  {item.cashCollectedKobo ? ` · cash ${money(item.cashCollectedKobo)}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                <Text variant="bodyStrong">{money(item.earningKobo)}</Text>
                <StatusBadge label={label} tone={tone} />
              </View>
            </View>
          );
        }}
        ListEmptyComponent={history.isPending ? <CardSkeleton /> : history.isError ? <ErrorState message={errorMessage(history.error)} onRetry={history.refetch} /> : <EmptyState icon="bicycle-outline" title="No deliveries yet" message="Completed deliveries will appear here." />}
      />
      <CashHandInSheet key={handIn ? 'open' : 'closed'} visible={handIn} onClose={() => setHandIn(false)} availableKobo={available} onSubmit={declare} busy={sending} serverError={handInError} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: spacing.xxl },
  chips: { flexDirection: 'row', gap: spacing.sm },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: { flexGrow: 1, flexBasis: 150, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  cashCard: { backgroundColor: colors.warningSoft },
  section: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, alignItems: 'center' },
  sep: { height: 1, backgroundColor: colors.border },
});
