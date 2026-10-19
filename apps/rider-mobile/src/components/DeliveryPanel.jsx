import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Chip, Sheet, StatusBadge, Text, TextField } from './ui';
import { PROBLEM_REASONS, RELEASE_REASONS, mapsUrl, money, stepFor, validateCompletion } from '../lib/delivery';
import { colors, radius, spacing, touchTarget } from '../theme/tokens';

function ContactRow({ icon, label, phone, url, testID }) {
  return (
    <View style={styles.contact}>
      {phone ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Call ${label}`} onPress={() => Linking.openURL(`tel:${phone}`)} style={styles.iconBtn} testID={testID ? `${testID}-call` : undefined}>
          <Ionicons name="call-outline" size={20} color={colors.primary} />
        </Pressable>
      ) : null}
      {url ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Directions to ${label}`} onPress={() => Linking.openURL(url)} style={styles.iconBtn} testID={testID ? `${testID}-map` : undefined}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** PIN + cash confirmation. Validates locally first; the API re-checks everything. */
export function CompleteForm({ delivery, onSubmit, busy, serverError }) {
  const [pin, setPin] = useState('');
  const [cashText, setCashText] = useState('');
  const [errors, setErrors] = useState({});
  const submit = () => {
    const v = validateCompletion({ pin, cashText }, delivery);
    setErrors(v.errors);
    if (v.ok) onSubmit(pin, v.cashCollectedKobo);
  };
  return (
    <View style={{ gap: spacing.sm }}>
      {delivery.cashToCollectKobo > 0 ? (
        <TextField label={`Cash received (amount due ${money(delivery.cashToCollectKobo)})`} value={cashText} onChangeText={setCashText} keyboardType="decimal-pad" placeholder={String(delivery.cashToCollectKobo / 100)} error={errors.cash} testID="cash-input" />
      ) : null}
      <TextField
        label="Customer’s 4-digit PIN"
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        error={errors.pin}
        hint={`${delivery.pinAttemptsLeft} ${delivery.pinAttemptsLeft === 1 ? 'attempt' : 'attempts'} left`}
        testID="pin-input"
      />
      {serverError ? (
        <Text tone="danger" accessibilityRole="alert" testID="complete-error">
          {serverError}
        </Text>
      ) : null}
      <Button title="Complete delivery" icon="checkmark-done" onPress={submit} loading={busy} disabled={delivery.pinAttemptsLeft === 0} fullWidth testID="complete-delivery" />
    </View>
  );
}

/** Reason picker used for both "hand back" (before pickup) and "report a problem" (after). */
export function ReasonSheet({ visible, title, reasons, confirmLabel, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={<Button title={confirmLabel} variant="danger" onPress={() => onConfirm(reason, note.trim() || undefined)} disabled={!reason} loading={busy} fullWidth testID="reason-confirm" />}
    >
      <View style={styles.chips}>
        {reasons.map(([value, label]) => (
          <Chip key={value} label={label} selected={reason === value} onPress={() => setReason(value)} />
        ))}
      </View>
      <TextField label="Details (optional)" value={note} onChangeText={setNote} maxLength={300} multiline testID="reason-note" />
    </Sheet>
  );
}

/**
 * The active delivery, one step at a time: go to the restaurant → collect → deliver with PIN (and
 * cash). Actions shown come from the API's `actions` list.
 */
export function DeliveryPanel({ delivery, onAction, busy, completeError }) {
  const [sheet, setSheet] = useState(null); // 'release' | 'problem'
  const step = stepFor(delivery);
  const has = (a) => delivery.actions.includes(a);
  const r = delivery.restaurant;
  const d = delivery.dropoff;
  const atCustomerStage = delivery.status === 'PICKED_UP';

  return (
    <View style={styles.card} testID="delivery-panel">
      <View style={styles.row}>
        <StatusBadge label={`Order ${delivery.orderCode}`} tone="neutral" icon="receipt-outline" />
        {delivery.cashToCollectKobo > 0 ? <StatusBadge label={`Cash ${money(delivery.cashToCollectKobo)}`} tone="warning" icon="cash-outline" /> : <StatusBadge label="Paid online" tone="success" icon="card-outline" />}
      </View>
      <Text variant="title" testID="step-title">
        {step.title}
      </Text>
      {step.hint ? <Text tone="muted">{step.hint}</Text> : null}

      {!atCustomerStage ? (
        <View style={styles.place}>
          <Ionicons name="restaurant-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{r.name}</Text>
            <Text tone="muted">
              {r.addressLine}, {r.area}
            </Text>
          </View>
          <ContactRow icon="navigate-outline" label={r.name} phone={r.phone} url={mapsUrl(r)} testID="restaurant" />
        </View>
      ) : null}

      {d ? (
        <View style={[styles.place, !atCustomerStage && styles.placeMuted]}>
          <Ionicons name="location-outline" size={22} color={colors.info} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">
              {d.customerFirstName} · {d.area}
            </Text>
            <Text tone="muted">{[d.line1, d.line2].filter(Boolean).join(', ')}</Text>
            {d.landmark ? <Text tone="muted">Landmark: {d.landmark}</Text> : null}
            {d.instructions ? <Text tone="muted">“{d.instructions}”</Text> : null}
            {delivery.customerNote ? <Text tone="muted">Note: {delivery.customerNote}</Text> : null}
          </View>
          {atCustomerStage ? <ContactRow icon="navigate-outline" label={d.customerFirstName} phone={d.contactPhone} url={mapsUrl(d)} testID="customer" /> : null}
        </View>
      ) : null}

      <View style={styles.items}>
        {delivery.items.map((i, idx) => (
          <Text key={idx}>
            {i.quantity}× {i.name}
            {i.variantName ? ` (${i.variantName})` : ''}
            {i.extras.length ? ` + ${i.extras.join(', ')}` : ''}
          </Text>
        ))}
      </View>

      {has('arrived') ? <Button title="I’ve arrived at the restaurant" variant="secondary" icon="flag-outline" onPress={() => onAction('arrived')} loading={busy === 'arrived'} fullWidth testID="action-arrived" /> : null}
      {has('picked_up') ? (
        <Button title={delivery.foodReady ? 'I’ve collected the food' : 'Waiting for food to be ready'} icon="bag-check-outline" onPress={() => onAction('picked_up')} disabled={!delivery.foodReady} loading={busy === 'picked_up'} fullWidth testID="action-picked-up" />
      ) : null}
      {has('complete') ? <CompleteForm delivery={delivery} busy={busy === 'complete'} serverError={completeError} onSubmit={(pin, cash) => onAction('complete', { pin, cash })} /> : null}

      {has('release') ? <Button title="I can’t do this delivery" variant="ghost" onPress={() => setSheet('release')} fullWidth testID="action-release" /> : null}
      {has('report_problem') ? <Button title="Report a problem" variant="ghost" icon="warning-outline" onPress={() => setSheet('problem')} fullWidth testID="action-problem" /> : null}

      <ReasonSheet
        visible={sheet === 'release'}
        title="Hand this delivery back?"
        reasons={RELEASE_REASONS}
        confirmLabel="Hand it back"
        busy={busy === 'release'}
        onClose={() => setSheet(null)}
        onConfirm={(reason, note) => {
          setSheet(null);
          onAction('release', { reason, note });
        }}
      />
      <ReasonSheet
        visible={sheet === 'problem'}
        title="What went wrong?"
        reasons={PROBLEM_REASONS}
        confirmLabel="Report problem"
        busy={busy === 'problem'}
        onClose={() => setSheet(null)}
        onConfirm={(reason, note) => {
          setSheet(null);
          onAction('problem', { reason, note });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  place: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  placeMuted: { opacity: 0.85 },
  contact: { flexDirection: 'row', gap: spacing.xs },
  iconBtn: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  items: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
});
