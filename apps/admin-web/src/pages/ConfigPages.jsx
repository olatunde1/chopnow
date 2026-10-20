import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgePercent, Plus } from 'lucide-react';
import { useAction } from '../components/admin';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, Modal, Money, PageHeader, Select, Switch, Table, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, koboToNairaInput, nairaToKobo } from '../lib/format';

// ───────── Promotions ─────────

const describe = (p) =>
  p.type === 'PERCENT_OFF' ? `${p.percentBps / 100}% off${p.maxDiscountKobo ? ` (max ₦${(p.maxDiscountKobo / 100).toLocaleString('en-NG')})` : ''}` : p.type === 'FIXED_OFF' ? `₦${(p.amountKobo / 100).toLocaleString('en-NG')} off` : 'Free delivery';

/** Builds the API payload from the form (naira → kobo, % → basis points, Lagos dates → ISO). */
export function toPromotionPayload(f) {
  const kobo = (v) => (v === '' ? undefined : nairaToKobo(v) ?? NaN);
  return {
    code: f.code.trim(),
    description: f.description.trim(),
    type: f.type,
    ...(f.type === 'PERCENT_OFF' ? { percentBps: Math.round(Number(f.percent) * 100), ...(f.maxDiscount ? { maxDiscountKobo: kobo(f.maxDiscount) } : {}) } : {}),
    ...(f.type === 'FIXED_OFF' ? { amountKobo: kobo(f.amount) } : {}),
    minSubtotalKobo: kobo(f.minSubtotal || '0'),
    ...(f.restaurantId ? { restaurantId: f.restaurantId } : {}),
    fundedBy: f.fundedBy,
    // Lagos is UTC+1: a promotion runs from 00:00 on the start date to 23:59 on the end date, Lagos time.
    startsAt: new Date(Date.parse(`${f.starts}T00:00:00+01:00`)).toISOString(),
    endsAt: new Date(Date.parse(`${f.ends}T23:59:59+01:00`)).toISOString(),
    ...(f.usageLimit ? { usageLimit: Number(f.usageLimit) } : {}),
    perCustomerLimit: Number(f.perCustomerLimit || 1),
  };
}

function PromotionForm({ onClose }) {
  const restaurants = useQuery({ queryKey: ['admin-restaurants', { status: 'APPROVED', pageSize: 100 }], queryFn: () => api.restaurants.list({ status: 'APPROVED', page: 1, pageSize: 100 }) });
  const [f, setF] = useState({ code: '', description: '', type: 'PERCENT_OFF', percent: '10', maxDiscount: '', amount: '', minSubtotal: '', restaurantId: '', fundedBy: 'PLATFORM', starts: '', ends: '', usageLimit: '', perCustomerLimit: '1' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const { run, busy } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    setMessage(null);
    if (!f.starts || !f.ends) return setErrors({ ends: 'Choose start and end dates' });
    const res = await run(() => api.promotions.create(toPromotionPayload(f)), { success: (p) => `${p.code} created`, invalidate: [['promotions']] });
    if (res.ok) onClose();
    else {
      setErrors(res.error?.fieldErrors?.() ?? {});
      setMessage(res.message);
    }
  };

  return (
    <Modal open onClose={onClose} title="New promotion" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Create</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {message ? <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad sm:col-span-2">{message}</p> : null}
        <Input label="Code" value={f.code} onChange={set('code')} error={errors.code} hint="Customers type this. 4–20 letters or digits." />
        <Select label="Type" value={f.type} onChange={set('type')}>
          <option value="PERCENT_OFF">Percentage off food</option>
          <option value="FIXED_OFF">Fixed amount off</option>
          <option value="FREE_DELIVERY">Free delivery</option>
        </Select>
        <Textarea className="sm:col-span-2" label="Description (shown to customers)" value={f.description} onChange={set('description')} error={errors.description} rows={2} />
        {f.type === 'PERCENT_OFF' ? <><Input label="Percent off" inputMode="decimal" value={f.percent} onChange={set('percent')} error={errors.percentBps} /><Input label="Maximum discount (₦, optional)" inputMode="decimal" value={f.maxDiscount} onChange={set('maxDiscount')} error={errors.maxDiscountKobo} /></> : null}
        {f.type === 'FIXED_OFF' ? <Input label="Amount off (₦)" inputMode="decimal" value={f.amount} onChange={set('amount')} error={errors.amountKobo} /> : null}
        <Input label="Minimum food spend (₦)" inputMode="decimal" value={f.minSubtotal} onChange={set('minSubtotal')} error={errors.minSubtotalKobo} />
        <Select label="Restaurant" value={f.restaurantId} onChange={set('restaurantId')} error={errors.restaurantId}>
          <option value="">All restaurants</option>
          {(restaurants.data?.items ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select label="Who pays for the discount" value={f.fundedBy} onChange={set('fundedBy')} hint="Restaurant-funded discounts are deducted from that restaurant’s settlement.">
          <option value="PLATFORM">ChopNow</option>
          <option value="RESTAURANT">The restaurant</option>
        </Select>
        <Input label="Starts (Nigeria date)" type="date" value={f.starts} onChange={set('starts')} error={errors.startsAt} />
        <Input label="Ends (Nigeria date, inclusive)" type="date" value={f.ends} onChange={set('ends')} error={errors.endsAt ?? errors.ends} />
        <Input label="Total uses (optional)" type="number" min={1} value={f.usageLimit} onChange={set('usageLimit')} error={errors.usageLimit} />
        <Input label="Uses per customer" type="number" min={1} max={100} value={f.perCustomerLimit} onChange={set('perCustomerLimit')} error={errors.perCustomerLimit} />
      </div>
    </Modal>
  );
}

export function PromotionsPage() {
  const list = useQuery({ queryKey: ['promotions'], queryFn: api.promotions.list });
  const { run } = useAction();
  const [creating, setCreating] = useState(false);
  const now = Date.now();

  return (
    <>
      <PageHeader title="Promotions" description="Codes customers enter at checkout. Pausing a code stops new uses immediately." actions={<Button icon={Plus} onClick={() => setCreating(true)}>New promotion</Button>} />
      <Card>
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
          <Table
            columns={[
              { key: 'code', header: 'Code', render: (p) => <span className="font-mono font-bold">{p.code}</span> },
              { key: 'what', header: 'Offer', render: (p) => <span className="text-sm">{describe(p)}{p.minSubtotalKobo ? <> on ₦{(p.minSubtotalKobo / 100).toLocaleString('en-NG')}+</> : null}</span> },
              { key: 'where', header: 'Where', render: (p) => p.restaurantName ?? 'All restaurants' },
              { key: 'funded', header: 'Paid by', render: (p) => (p.fundedBy === 'PLATFORM' ? 'ChopNow' : 'Restaurant') },
              { key: 'when', header: 'Runs', render: (p) => <span className="text-sm">{dateTime(p.startsAt)} – {dateTime(p.endsAt)}{Date.parse(p.endsAt) < now ? <Badge tone="neutral">Ended</Badge> : null}</span> },
              { key: 'used', header: 'Used', align: 'right', render: (p) => `${p.redemptions}${p.usageLimit ? ` / ${p.usageLimit}` : ''}` },
              { key: 'active', header: 'Active', render: (p) => <Switch checked={p.isActive} label={`${p.code} active`} onChange={(on) => run(() => api.promotions.update(p.id, { isActive: on }), { success: on ? `${p.code} resumed` : `${p.code} paused`, invalidate: [['promotions']] })} /> },
            ]}
            rows={list.data.items}
            rowKey={(p) => p.id}
            empty={<EmptyState icon={BadgePercent} title="No promotions yet" />}
          />
        )}
      </Card>
      {creating ? <PromotionForm onClose={() => setCreating(false)} /> : null}
    </>
  );
}

// ───────── Business rules ─────────

const RULE_LABELS = {
  pricing: ['Pricing', { commissionBps: 'Restaurant commission', deliveryBaseFeeKobo: 'Delivery fee (base)', deliveryIncludedMeters: 'Distance included in base fee', deliveryPerKmKobo: 'Delivery fee per extra km', deliveryFeeCapKobo: 'Delivery fee cap', riderShareOfDeliveryBps: 'Rider share of delivery fee', riderMinEarningKobo: 'Minimum rider earning', serviceFeeBps: 'Service fee', serviceFeeMinKobo: 'Service fee minimum', serviceFeeMaxKobo: 'Service fee maximum' }],
  cashOnDelivery: ['Cash on delivery', { enabled: 'Cash on delivery enabled', maxOrderTotalKobo: 'Maximum cash order', newCustomerMaxOrderTotalKobo: 'Maximum first cash order', riderOutstandingCashLimitKobo: 'Rider cash limit (no cash offers above)', allowPartialCollection: 'Allow partial cash collection' }],
  dispatch: ['Dispatch', { offerTimeoutSeconds: 'Offer timeout', coreOnlyWindowSeconds: 'Core riders only for', alertOperationsAfterSeconds: 'Alert operations after', startDispatchOn: 'Start looking for a rider when', maxPinAttempts: 'Wrong PIN attempts allowed' }],
  orders: ['Orders', { vendorAcceptTimeoutSeconds: 'Restaurant must accept within', unpaidOnlineOrderTimeoutSeconds: 'Unpaid online orders close after', defaultDeliveryRadiusMeters: 'Default delivery radius', maxItemQuantity: 'Maximum quantity per item', timezone: 'Timezone' }],
};
const unit = (key) => (key.endsWith('Kobo') ? '₦' : key.endsWith('Bps') ? '%' : key.endsWith('Seconds') ? 'seconds' : key.endsWith('Meters') ? 'metres' : '');
const toInput = (key, v) => (key.endsWith('Kobo') ? koboToNairaInput(v) : key.endsWith('Bps') ? String(v / 100) : String(v));
const fromInput = (key, s) => (key.endsWith('Kobo') ? nairaToKobo(s) : key.endsWith('Bps') ? Math.round(Number(s) * 100) : Number(s));

/** Edits the runtime business rules. Changes apply to new orders only (orders keep a snapshot). */
export function SettingsPage() {
  const q = useQuery({ queryKey: ['business-rules'], queryFn: api.settings.get });
  const [draft, setDraft] = useState(null);
  const { run, busy } = useAction();
  if (q.isPending) return <LoadingBlock label="Loading rules" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rules = q.data;
  const form = draft ?? Object.fromEntries(Object.entries(rules).map(([s, obj]) => [s, Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'number' ? toInput(k, v) : v]))]));
  const set = (section, key, value) => setDraft({ ...form, [section]: { ...form[section], [key]: value } });
  const changed = draft !== null;

  const save = async () => {
    const out = {};
    for (const [section, obj] of Object.entries(form)) {
      out[section] = {};
      for (const [k, v] of Object.entries(obj)) out[section][k] = typeof rules[section][k] === 'number' ? fromInput(k, v) : v;
    }
    const res = await run(() => api.settings.put(out), { success: 'Rules saved. New orders use them from now on.', invalidate: [['business-rules']] });
    if (res.ok) setDraft(null);
  };

  return (
    <>
      <PageHeader title="Business rules" description="Fees, commission, cash and dispatch settings. Changes affect new orders only and are recorded in the audit log." actions={<><Button variant="outline" disabled={!changed} onClick={() => setDraft(null)}>Discard</Button><Button onClick={save} loading={busy} disabled={!changed}>Save rules</Button></>} />
      <div className="grid gap-5 lg:grid-cols-2">
        {Object.entries(RULE_LABELS).map(([section, [title, labels]]) => (
          <Card key={section}>
            <h2 className="mb-4 text-lg font-bold">{title}</h2>
            <div className="flex flex-col gap-3">
              {Object.entries(labels).map(([key, label]) => {
                const v = form[section]?.[key];
                if (v === undefined) return null;
                if (typeof v === 'boolean') return <Switch key={key} checked={v} onChange={(on) => set(section, key, on)} label={label} description={v ? 'On' : 'Off'} />;
                if (key === 'startDispatchOn') return <Select key={key} label={label} value={v} onChange={(e) => set(section, key, e.target.value)}><option value="ACCEPTED">The restaurant accepts</option><option value="READY_FOR_PICKUP">The food is ready</option></Select>;
                if (key === 'timezone') return <Input key={key} label={label} value={v} disabled />;
                return <Input key={key} label={`${label}${unit(key) ? ` (${unit(key)})` : ''}`} inputMode="decimal" value={v} onChange={(e) => set(section, key, e.target.value)} />;
              })}
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-muted">Current commission: {rules.pricing.commissionBps / 100}% · Delivery from <Money kobo={rules.pricing.deliveryBaseFeeKobo} /> · Rider cash limit <Money kobo={rules.cashOnDelivery.riderOutstandingCashLimitKobo} /></p>
    </>
  );
}
