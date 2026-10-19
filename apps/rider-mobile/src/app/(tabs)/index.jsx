import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DeliveryPanel } from '../../components/DeliveryPanel';
import { OfferCard } from '../../components/OfferCard';
import { Button, CardSkeleton, ErrorState, Screen, StatusBadge, Text, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api-client';
import { APPROVAL_LABEL, money } from '../../lib/delivery';
import { errorMessage, useLocationReporting, useProfile, useWork } from '../../lib/hooks';
import { useLiveStatus } from '../../lib/live';
import { colors, radius, spacing } from '../../theme/tokens';

export default function DeliveriesScreen() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const online = profile.data?.availability === 'ONLINE';
  const work = useWork(online, useLiveStatus());
  const delivery = work.data?.delivery ?? null;
  const offer = work.data?.offer ?? null;
  const [busy, setBusy] = useState(null);
  const [completeError, setCompleteError] = useState(null);
  useLocationReporting(online);

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['rider'] })]);

  const toggleOnline = async (next) => {
    setBusy('online');
    try {
      await api.rider.setOnline(next);
      toast.show(next ? 'You’re online. Offers will appear here.' : 'You’re offline.', next ? 'success' : 'info');
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const respond = async (accept) => {
    setBusy(accept ? 'accept' : 'decline');
    try {
      if (accept) {
        await api.rider.accept(offer.id);
        toast.show('Delivery accepted. Head to the restaurant.', 'success');
      } else {
        await api.rider.decline(offer.id);
      }
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const act = async (action, args = {}) => {
    setBusy(action);
    setCompleteError(null);
    try {
      if (action === 'arrived') await api.rider.arrived(delivery.id);
      if (action === 'picked_up') await api.rider.pickedUp(delivery.id);
      if (action === 'complete') {
        await api.rider.complete(delivery.id, args.pin, args.cash);
        toast.show(`Delivered! ${money(delivery.earningKobo)} added to your earnings.`, 'success');
      }
      if (action === 'release') {
        await api.rider.release(delivery.id, args.reason, args.note);
        toast.show('Delivery handed back. We’ll find another rider.', 'info');
      }
      if (action === 'problem') {
        await api.rider.problem(delivery.id, args.reason, args.note);
        toast.show('Problem reported. Operations will contact you.', 'info');
      }
    } catch (e) {
      if (action === 'complete' && e instanceof ApiError) setCompleteError(e.message);
      else toast.show(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  if (profile.isPending) {
    return (
      <Screen>
        <View style={styles.pad}>
          <CardSkeleton />
        </View>
      </Screen>
    );
  }
  if (profile.isError) return <ErrorState message={errorMessage(profile.error)} onRetry={profile.refetch} />;
  const me = profile.data;
  const approved = me.verificationStatus === 'APPROVED';
  const cashFull = me.outstandingCashKobo >= me.cashLimitKobo;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={work.isRefetching} onRefresh={refresh} tintColor={colors.primary} />}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="title">Hi, {me.fullName.split(' ')[0]}</Text>
            <Text tone="muted">
              Today: {money(me.todayEarningsKobo)} · {me.todayDeliveries} {me.todayDeliveries === 1 ? 'delivery' : 'deliveries'}
            </Text>
          </View>
          <Button title="Alerts" variant="ghost" size="sm" icon="notifications-outline" onPress={() => router.push('/notifications')} accessibilityLabel="Notifications" />
        </View>

        {!approved ? (
          <View style={styles.notice} accessibilityRole="alert">
            <StatusBadge label={APPROVAL_LABEL[me.verificationStatus]} tone={me.verificationStatus === 'PENDING' ? 'warning' : 'danger'} />
            <Text>
              {me.verificationStatus === 'PENDING'
                ? 'We’re checking your application. Upload your licence and ID to speed it up; you can go online once approved.'
                : me.verificationNote ?? 'Contact ChopNow support about your account.'}
            </Text>
            <Button title="Upload documents" variant="secondary" icon="document-attach-outline" onPress={() => router.push('/account')} />
          </View>
        ) : (
          <View style={[styles.onlineCard, online && styles.onlineCardOn]}>
            <View style={{ flex: 1 }}>
              <Text variant="heading">{online ? 'You’re online' : 'You’re offline'}</Text>
              <Text tone="muted">{online ? (delivery ? 'Finish this delivery to get the next one.' : 'Waiting for offers…') : 'Go online to receive delivery offers.'}</Text>
            </View>
            <Switch
              value={online}
              onValueChange={toggleOnline}
              disabled={busy === 'online'}
              accessibilityLabel="Online for deliveries"
              trackColor={{ true: colors.success, false: colors.border }}
              thumbColor={colors.surface}
              testID="online-switch"
            />
          </View>
        )}

        {cashFull && approved ? (
          <View style={styles.notice}>
            <Ionicons name="cash-outline" size={20} color={colors.warning} />
            <Text>
              You’re holding {money(me.outstandingCashKobo)} in cash. Hand it to ChopNow to receive cash orders again (online-paid orders still come through).
            </Text>
          </View>
        ) : null}

        {work.isError ? <ErrorState message={errorMessage(work.error)} onRetry={work.refetch} /> : null}

        {delivery ? (
          <DeliveryPanel delivery={delivery} onAction={act} busy={busy} completeError={completeError} />
        ) : offer ? (
          <OfferCard key={offer.id} offer={offer} busy={busy === 'accept' || busy === 'decline'} onAccept={() => respond(true)} onDecline={() => respond(false)} />
        ) : online ? (
          <View style={styles.waiting} testID="waiting">
            <Ionicons name="radio-outline" size={40} color={colors.textMuted} />
            <Text tone="muted">No offers right now. Keep the app open; we check every few seconds.</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center' },
  notice: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  onlineCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  onlineCardOn: { borderColor: colors.success, backgroundColor: colors.successSoft },
  waiting: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
});
