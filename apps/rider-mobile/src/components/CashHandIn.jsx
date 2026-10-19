import { useState } from 'react';
import { View } from 'react-native';
import { Button, Sheet, StatusBadge, Text, TextField } from './ui';
import { REMITTANCE_STATUS, SETTLEMENT_STATUS, money, validateHandIn } from '../lib/delivery';
import { spacing } from '../theme/tokens';

/**
 * "I've transferred my cash" form. Finance confirms it against the bank statement; until then the
 * amount stays in "cash to hand in". `availableKobo` = outstanding − transfers awaiting confirmation.
 */
export function CashHandInSheet({ visible, onClose, availableKobo, onSubmit, busy, serverError }) {
  const [amountText, setAmountText] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState({});
  const submit = () => {
    const v = validateHandIn({ amountText, reference }, availableKobo);
    setErrors(v.errors);
    if (v.ok) onSubmit(v.amountKobo, reference.trim());
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Declare a cash transfer" footer={<Button title="Send to finance" onPress={submit} loading={busy} fullWidth testID="handin-submit" />}>
      <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
        <Text tone="muted">Transfer the cash you collected to ChopNow’s account, then tell us the amount and the reference from your bank app. You can declare up to {money(availableKobo)}.</Text>
        <TextField label="Amount transferred (₦)" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" error={errors.amount} testID="handin-amount" />
        <TextField label="Transfer reference" value={reference} onChangeText={setReference} autoCapitalize="characters" maxLength={100} error={errors.reference} testID="handin-reference" />
        {serverError ? (
          <Text tone="danger" accessibilityRole="alert" testID="handin-error">
            {serverError}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }) : '');

export function RemittanceRow({ r }) {
  const [label, tone] = REMITTANCE_STATUS[r.status] ?? [r.status, 'neutral'];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{money(r.amountKobo)}</Text>
        <Text tone="muted">
          {r.method === 'CASH_HANDOVER' ? 'Handed in' : `Transfer ${r.reference ?? ''}`} · {when(r.createdAt)}
        </Text>
        {r.status === 'REJECTED' && r.note ? <Text tone="danger">{r.note}</Text> : null}
      </View>
      <StatusBadge label={label} tone={tone} />
    </View>
  );
}

export function SettlementRow({ s }) {
  const [label, tone] = SETTLEMENT_STATUS[s.status] ?? [s.status, 'neutral'];
  const paid = s.payouts.find((p) => p.status === 'SUCCESSFUL');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }} testID={`settlement-${s.id}`}>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">
          {when(`${s.from}T12:00:00Z`)} – {when(`${s.to}T12:00:00Z`)} · {s.deliveryCount} deliveries
        </Text>
        <Text tone="muted">{paid ? `Paid ${when(paid.completedAt)} · ref ${paid.reference}` : s.netPayableKobo > 0 ? 'Payment on the way' : 'Nothing to pay this period'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
        <Text variant="bodyStrong">{money(s.netPayableKobo)}</Text>
        <StatusBadge label={label} tone={tone} />
      </View>
    </View>
  );
}
