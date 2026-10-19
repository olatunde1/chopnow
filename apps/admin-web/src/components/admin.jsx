import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Modal, Select, Textarea, useToast } from './ui';
import { ApiError } from '../lib/api';

/** Status → [label, tone] for everything the dashboard shows. Unknown values fall back to the raw value. */
const LABELS = {
  // orders
  PLACED: ['New', 'brand'], ACCEPTED: ['Accepted', 'info'], PREPARING: ['Preparing', 'info'], READY_FOR_PICKUP: ['Ready', 'info'],
  PICKED_UP: ['On the way', 'info'], DELIVERED: ['Delivered', 'ok'], CANCELLED: ['Cancelled', 'neutral'], REJECTED: ['Declined', 'neutral'], DELIVERY_EXCEPTION: ['Delivery problem', 'bad'],
  // deliveries
  UNASSIGNED: ['No rider', 'warn'], OFFERING: ['Finding rider', 'warn'], ASSIGNED: ['Rider assigned', 'info'], ARRIVED_AT_RESTAURANT: ['Rider at restaurant', 'info'], FAILED: ['Failed', 'bad'],
  // payments / refunds
  PENDING: ['Pending', 'warn'], SUCCESSFUL: ['Paid', 'ok'], REFUND_PENDING: ['Refund pending', 'warn'], PARTIALLY_REFUNDED: ['Part refunded', 'info'], REFUNDED: ['Refunded', 'neutral'],
  REQUESTED: ['Requested', 'warn'], APPROVED: ['Approved', 'info'], PROCESSING: ['Processing', 'warn'],
  // approvals and accounts
  SUSPENDED: ['Suspended', 'bad'], ACTIVE: ['Active', 'ok'], DEACTIVATED: ['Deactivated', 'neutral'], ACCEPTED_DOC: ['Accepted', 'ok'],
  // settlements, remittances, payouts
  DRAFT: ['Draft', 'warn'], PAYOUT_INITIATED: ['Transfer in progress', 'warn'], PAID: ['Paid', 'ok'], PENDING_CONFIRMATION: ['To confirm', 'warn'], CONFIRMED: ['Confirmed', 'ok'], INITIATED: ['In progress', 'warn'],
  PUBLISHED: ['Published', 'ok'], HIDDEN: ['Hidden', 'neutral'], ONLINE: ['Online', 'ok'], OFFLINE: ['Offline', 'neutral'],
};
const FAILED_TONE = { FAILED: ['Failed', 'bad'] };

export function Status({ value, kind }) {
  if (!value) return null;
  const key = kind === 'document' && value === 'ACCEPTED' ? 'ACCEPTED_DOC' : kind === 'payment' && value === 'FAILED' ? 'FAILED' : value;
  const [label, tone] = LABELS[key] ?? FAILED_TONE[key] ?? [String(value).toLowerCase().replace(/_/g, ' '), 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * Runs a staff action: shows a toast with the result, refreshes the given queries, and returns
 * the API error (if any) so a dialog can stay open and show it.
 */
export function useAction() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (fn, { success, invalidate = [] } = {}) => {
    setBusy(true);
    try {
      const result = await fn();
      if (success) toast.show(typeof success === 'function' ? success(result) : success, 'success');
      await Promise.all(invalidate.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      return { ok: true, result };
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Something went wrong.';
      toast.show(message, 'danger');
      return { ok: false, error: e, message };
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/**
 * Confirmation dialog that asks for a reason (and optional extra fields). Every staff change is
 * audited with this reason. `fields`: [{ name, label, type: 'text'|'select'|'number', options, required, hint }]
 */
export function ReasonDialog({ open, title, message, confirmLabel = 'Confirm', destructive, fields = [], reasonLabel = 'Reason (recorded in the audit log)', requireReason = true, onClose, onSubmit }) {
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const reason = values.reason ?? '';
  const missing = (requireReason && reason.trim().length < 5) || fields.some((f) => f.required && !String(values[f.name] ?? '').trim());

  const close = () => {
    setValues({});
    setError(null);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await onSubmit({ ...values, reason: reason.trim() });
    setBusy(false);
    if (res?.ok === false) setError(res.message);
    else close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={missing}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {message ? <p className="text-ink-muted">{message}</p> : null}
        {fields.map((f) =>
          f.type === 'select' ? (
            <Select key={f.name} label={f.label} hint={f.hint} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
              <option value="">Choose…</option>
              {f.options.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          ) : (
            <Input key={f.name} label={f.label} hint={f.hint} inputMode={f.type === 'number' ? 'decimal' : undefined} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
          ),
        )}
        {requireReason ? <Textarea label={reasonLabel} value={reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} hint="At least 5 characters." /> : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Two-column definition list. rows: [label, value][] (falsy values shown as "—"). */
export function Facts({ rows }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="min-w-0 break-words">{value === null || value === undefined || value === '' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Filter chips bound to a value. options: [value, label][] ('' = all). */
export function FilterChips({ value, onChange, options, label }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v || 'all'}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${value === v ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:border-ink-muted'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export const ago = (iso, now = Date.now()) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};
export const minutes = (seconds) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)} min`);
