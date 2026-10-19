import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Banknote, Landmark, Undo2, Wallet } from 'lucide-react';
import { FilterChips, ReasonDialog, Status, ago, useAction } from '../components/admin';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, Money, PageHeader, Pagination, Table } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, daysAgo, lagosToday, nairaToKobo } from '../lib/format';
import { useSession } from '../state/session';

const CHARGE = { CUSTOMER_FUNDS: 'Customer’s payment', RESTAURANT: 'Restaurant', PLATFORM: 'ChopNow', UNAPPLIED_PAYMENT: 'Duplicate/wrong charge' };
export const ACCOUNT = {
  PROVIDER_CLEARING: 'Held by payment provider', RIDER_CASH_HELD: 'Cash held by riders', PLATFORM_BANK: 'ChopNow bank', CUSTOMER_ORDER_FUNDS: 'Customer funds (orders in progress)',
  VENDOR_PAYABLE: 'Owed to restaurants', RIDER_PAYABLE: 'Owed to riders', PLATFORM_COMMISSION_REVENUE: 'Commission revenue', PLATFORM_DELIVERY_REVENUE: 'Delivery margin',
  PLATFORM_SERVICE_FEE_REVENUE: 'Service fee revenue', PROMOTION_EXPENSE: 'Promotion cost', REFUNDS_PAYABLE: 'Refunds owed', ADJUSTMENTS: 'Adjustments',
};

// ───────── Summary ─────────

export function FinanceSummaryPage() {
  const today = lagosToday();
  const [range, setRange] = useState({ from: daysAgo(today, 6), to: today });
  const q = useQuery({ queryKey: ['finance-summary', range], queryFn: () => api.finance.summary(range.from, range.to) });
  return (
    <>
      <PageHeader title="Finance summary" description="Straight from the ledger. Revenue counts orders delivered in the period; balances are as of now." />
      <Card className="mb-5 flex flex-wrap items-end gap-3">
        <Input label="From" type="date" value={range.from} max={today} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <Input label="To" type="date" value={range.to} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </Card>
      {q.isPending ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="flex flex-col gap-5">
          {!q.data.trialBalance.balanced ? <p role="alert" className="rounded-xl bg-bad-soft p-3 font-semibold text-bad">The ledger does not balance. Stop payouts and contact engineering.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Delivered orders', q.data.deliveredOrders, false],
              ['Gross order value', q.data.grossOrderValueKobo, true],
              ['ChopNow revenue', q.data.revenue.totalKobo, true],
              ['Refunds paid', q.data.refundsPaidKobo, true],
            ].map(([label, v, isMoney]) => (
              <Card key={label}><p className="text-sm text-ink-muted">{label}</p><p className="text-2xl font-extrabold">{isMoney ? <Money kobo={v} /> : v}</p></Card>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-lg font-bold">Revenue</h2>
              <dl className="grid grid-cols-2 gap-1.5 text-sm">
                <dt className="text-ink-muted">Commission</dt><dd className="text-right"><Money kobo={q.data.revenue.commissionKobo} /></dd>
                <dt className="text-ink-muted">Delivery margin (fee − rider earning)</dt><dd className="text-right"><Money kobo={q.data.revenue.deliveryMarginKobo} /></dd>
                <dt className="text-ink-muted">Service fees</dt><dd className="text-right"><Money kobo={q.data.revenue.serviceFeesKobo} /></dd>
                <dt className="text-ink-muted">Promotions ChopNow paid for</dt><dd className="text-right">−<Money kobo={q.data.promotionCostKobo} /></dd>
              </dl>
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-bold">Balances now</h2>
              <dl className="grid grid-cols-2 gap-1.5 text-sm">
                <dt className="text-ink-muted">Owed to restaurants</dt><dd className="text-right"><Money kobo={q.data.balances.owedToRestaurantsKobo} /></dd>
                <dt className="text-ink-muted">Owed to riders</dt><dd className="text-right"><Money kobo={q.data.balances.owedToRidersKobo} /></dd>
                <dt className="text-ink-muted">Cash riders still hold</dt><dd className="text-right"><Money kobo={q.data.balances.cashHeldByRidersKobo} /></dd>
                <dt className="text-ink-muted">Refunds owed to customers</dt><dd className="text-right"><Money kobo={q.data.balances.refundsOwedKobo} /></dd>
                <dt className="text-ink-muted">Held by payment provider</dt><dd className="text-right"><Money kobo={q.data.balances.providerClearingKobo} /></dd>
                <dt className="text-ink-muted">Customer funds (orders in progress)</dt><dd className="text-right"><Money kobo={q.data.balances.customerFundsHeldKobo} /></dd>
              </dl>
            </Card>
          </div>
          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">Trial balance {q.data.trialBalance.balanced ? <Badge tone="ok">Balanced</Badge> : <Badge tone="bad">Not balanced</Badge>}</h2>
            <Table
              columns={[
                { key: 'a', header: 'Account', render: (a) => ACCOUNT[a.account] ?? a.account },
                { key: 'd', header: 'Debits', align: 'right', render: (a) => <Money kobo={a.debitKobo} /> },
                { key: 'c', header: 'Credits', align: 'right', render: (a) => <Money kobo={a.creditKobo} /> },
              ]}
              rows={q.data.trialBalance.accounts.filter((a) => a.debitKobo || a.creditKobo)}
              rowKey={(a) => a.account}
              empty={<p className="p-4 text-sm text-ink-muted">No ledger entries yet.</p>}
            />
          </Card>
        </div>
      )}
    </>
  );
}

// ───────── Refunds ─────────

export function RefundsPage() {
  const { can, user } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'REQUESTED';
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { kind, refund }
  const { run } = useAction();
  const query = { page, pageSize: 25, ...(status ? { status } : {}) };
  const list = useQuery({ queryKey: ['refunds', query], queryFn: () => api.finance.refunds(query), placeholderData: (p) => p });
  const refresh = [['refunds'], ['dashboard']];
  const approver = can('refund.approve');

  const actionsFor = (r) => {
    if (!approver) return null;
    const own = r.requestedById === user.id;
    return (
      <div className="flex flex-wrap justify-end gap-1">
        {r.status === 'REQUESTED' ? (
          <>
            <Button size="sm" disabled={own} title={own ? 'Someone else must approve a refund you requested' : undefined} onClick={(e) => { e.stopPropagation(); r.orderStatus === 'DELIVERED' ? setDialog({ kind: 'approve', refund: r }) : run(() => api.finance.approveRefund(r.id), { success: 'Refund approved', invalidate: refresh }); }}>Approve</Button>
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDialog({ kind: 'reject', refund: r }); }}>Reject</Button>
          </>
        ) : null}
        {r.status === 'FAILED' && r.method === 'PROVIDER' ? <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); run(() => api.finance.retryRefund(r.id), { success: 'Retried', invalidate: refresh }); }}>Retry</Button> : null}
        {r.status === 'PROCESSING' ? <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); run(() => api.finance.refreshRefund(r.id), { success: 'Checked with provider', invalidate: refresh }); }}>Check</Button> : null}
        {r.status === 'APPROVED' || r.status === 'FAILED' ? <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDialog({ kind: 'paid', refund: r }); }}>Paid by transfer</Button> : null}
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Refunds" description="Approve, reject or complete refunds. Online refunds go back through the payment provider; cash orders are refunded by bank transfer." />
      <Card className="mb-4"><FilterChips label="Filter refunds" value={status} onChange={(v) => { setParams(v ? { status: v } : { status: '' }); setPage(1); }} options={[['REQUESTED', 'To decide'], ['PROCESSING', 'Processing'], ['APPROVED', 'Approved (manual)'], ['FAILED', 'Failed'], ['SUCCESSFUL', 'Refunded'], ['REJECTED', 'Rejected'], ['', 'All']]} /></Card>
      <Card>
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
          <>
            <Table
              columns={[
                { key: 'order', header: 'Order', render: (r) => <Link to={`/orders/${r.orderId}`} className="font-bold text-brand" onClick={(e) => e.stopPropagation()}>{r.orderCode}</Link> },
                { key: 'when', header: 'Requested', render: (r) => ago(r.createdAt) },
                { key: 'why', header: 'Reason', render: (r) => <span className="line-clamp-2 text-sm">{r.reason}</span> },
                { key: 'who', header: 'Borne by', render: (r) => (r.chargeTo ? CHARGE[r.chargeTo] : '—') },
                { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="flex items-center justify-end gap-1"><Money kobo={r.amountKobo} />{r.isTestPayment ? <Badge tone="warn">Test</Badge> : null}</span> },
                { key: 'status', header: 'Status', render: (r) => <span title={r.failureReason ?? undefined}><Status value={r.status} kind="payment" /></span> },
                { key: 'act', header: '', align: 'right', render: actionsFor },
              ]}
              rows={list.data.items}
              rowKey={(r) => r.id}
              empty={<EmptyState icon={Undo2} title="Nothing here" />}
            />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ReasonDialog
        open={dialog?.kind === 'approve'}
        title={`Approve refund for ${dialog?.refund.orderCode}`}
        message="This order was delivered, so its money has already been split. Choose who bears the refund."
        fields={[{ name: 'chargeTo', label: 'Borne by', type: 'select', required: true, options: [['RESTAURANT', 'The restaurant (deducted from its next settlement)'], ['PLATFORM', 'ChopNow']] }]}
        requireReason={false}
        confirmLabel="Approve and refund"
        onClose={() => setDialog(null)}
        onSubmit={({ chargeTo }) => run(() => api.finance.approveRefund(dialog.refund.id, chargeTo), { success: 'Refund approved', invalidate: refresh })}
      />
      <ReasonDialog open={dialog?.kind === 'reject'} title={`Reject refund for ${dialog?.refund.orderCode}?`} confirmLabel="Reject" destructive onClose={() => setDialog(null)} onSubmit={({ reason }) => run(() => api.finance.rejectRefund(dialog.refund.id, reason), { success: 'Refund rejected', invalidate: refresh })} />
      <ReasonDialog
        open={dialog?.kind === 'paid'}
        title="Record a refund paid by bank transfer"
        fields={[{ name: 'bankReference', label: 'Bank transfer reference', required: true }]}
        requireReason={false}
        confirmLabel="Mark as refunded"
        onClose={() => setDialog(null)}
        onSubmit={({ bankReference }) => run(() => api.finance.markRefundPaid(dialog.refund.id, bankReference.trim()), { success: 'Refund recorded', invalidate: refresh })}
      />
    </>
  );
}

// ───────── Rider cash ─────────

export function CashPage() {
  const positions = useQuery({ queryKey: ['cash'], queryFn: api.finance.cash });
  const pending = useQuery({ queryKey: ['remittances', 'pending'], queryFn: () => api.finance.remittances({ status: 'PENDING_CONFIRMATION', page: 1, pageSize: 50 }) });
  const recent = useQuery({ queryKey: ['remittances', 'recent'], queryFn: () => api.finance.remittances({ page: 1, pageSize: 20 }) });
  const { run } = useAction();
  const [dialog, setDialog] = useState(null);
  const refresh = [['cash'], ['remittances'], ['dashboard']];

  return (
    <>
      <PageHeader title="Rider cash" description="Cash riders collected and still hold. Confirm transfers against the bank statement; hand-ins clear each rider’s oldest cash first." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-bold">To confirm ({pending.data?.items.length ?? 0})</h2>
          {pending.isPending ? <LoadingBlock /> : pending.isError ? <ErrorState error={pending.error} onRetry={pending.refetch} /> : pending.data.items.length === 0 ? (
            <p className="text-sm text-ink-muted">No transfers waiting.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pending.data.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                  <span className="font-semibold">{r.riderName}</span>
                  <Money kobo={r.amountKobo} className="font-bold" />
                  <span className="text-ink-muted">ref {r.reference} · {ago(r.createdAt)}</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" onClick={() => run(() => api.finance.confirmRemittance(r.id), { success: 'Confirmed', invalidate: refresh })}>Confirm</Button>
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'reject', r })}>Reject</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Riders holding cash</h2>
          {positions.isPending ? <LoadingBlock /> : positions.isError ? <ErrorState error={positions.error} onRetry={positions.refetch} /> : positions.data.items.length === 0 ? (
            <EmptyState icon={Banknote} title="No cash outstanding" />
          ) : (
            <>
              <p className="mb-2 text-sm">Total: <Money kobo={positions.data.totalOutstandingKobo} className="font-bold" /></p>
              <ul className="divide-y divide-line">
                {positions.data.items.map((p) => (
                  <li key={p.riderId} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                    <span className="font-semibold">{p.riderName}</span>
                    <Money kobo={p.outstandingKobo} className={p.outstandingKobo >= p.limitKobo ? 'font-bold text-bad' : 'font-bold'} />
                    {p.outstandingKobo >= p.limitKobo ? <Badge tone="bad">At limit</Badge> : null}
                    <span className="text-ink-muted">{p.openCollections} orders · oldest {ago(p.oldestCollectedAt)}{p.pendingDeclaredKobo ? ' · declared ' : ''}{p.pendingDeclaredKobo ? <Money kobo={p.pendingDeclaredKobo} /> : null}</span>
                    <Button variant="outline" size="sm" className="ml-auto" onClick={() => setDialog({ kind: 'record', p })}>Record hand-in</Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
      <Card className="mt-5">
        <h2 className="mb-3 text-lg font-bold">Recent hand-ins</h2>
        {recent.data ? (
          <Table
            columns={[
              { key: 'when', header: 'When', render: (r) => dateTime(r.createdAt) },
              { key: 'rider', header: 'Rider', render: (r) => r.riderName },
              { key: 'how', header: 'How', render: (r) => (r.method === 'CASH_HANDOVER' ? 'In person' : `Transfer ${r.reference ?? ''}`) },
              { key: 'orders', header: 'Cleared', render: (r) => <span className="text-sm text-ink-muted">{r.allocations.map((a) => a.orderCode).join(', ') || '—'}</span> },
              { key: 'amount', header: 'Amount', align: 'right', render: (r) => <Money kobo={r.amountKobo} /> },
              { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
            ]}
            rows={recent.data.items}
            rowKey={(r) => r.id}
            empty={<p className="p-4 text-sm text-ink-muted">No hand-ins yet.</p>}
          />
        ) : <LoadingBlock />}
      </Card>
      <ReasonDialog open={dialog?.kind === 'reject'} title={`Reject ${dialog?.r?.riderName}’s transfer?`} reasonLabel="Reason (shown to the rider)" confirmLabel="Reject" destructive onClose={() => setDialog(null)} onSubmit={({ reason }) => run(() => api.finance.rejectRemittance(dialog.r.id, reason), { success: 'Rejected', invalidate: refresh })} />
      <ReasonDialog
        open={dialog?.kind === 'record'}
        title={`Record a hand-in from ${dialog?.p?.riderName}`}
        message="Use this when you counted the cash yourself or saw the transfer in the bank. It is confirmed immediately."
        fields={[
          { name: 'amount', label: 'Amount (₦)', type: 'number', required: true },
          { name: 'method', label: 'How', type: 'select', required: true, options: [['CASH_HANDOVER', 'Cash handed in'], ['BANK_TRANSFER', 'Bank transfer']] },
          { name: 'reference', label: 'Reference (optional)' },
        ]}
        reasonLabel="Note"
        requireReason={false}
        confirmLabel="Record"
        onClose={() => setDialog(null)}
        onSubmit={({ amount, method, reference }) => {
          const kobo = nairaToKobo(amount);
          if (!kobo) return { ok: false, message: 'Enter the amount in naira' };
          return run(() => api.finance.recordRemittance({ riderId: dialog.p.riderId, amountKobo: kobo, method, ...(reference?.trim() ? { reference: reference.trim() } : {}) }), { success: 'Hand-in recorded', invalidate: refresh });
        }}
      />
    </>
  );
}

// ───────── Settlements and payouts ─────────

export function SettlementsPage() {
  const { can } = useSession();
  const today = lagosToday();
  const yesterday = daysAgo(today, 1);
  const [period, setPeriod] = useState({ from: daysAgo(today, 7), to: yesterday });
  const [status, setStatus] = useState('DRAFT');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const [result, setResult] = useState(null);
  const { run, busy } = useAction();
  const query = { page, pageSize: 25, ...(status ? { status } : {}) };
  const list = useQuery({ queryKey: ['settlements', query], queryFn: () => api.finance.settlements(query), placeholderData: (p) => p });
  const refresh = [['settlements'], ['finance-summary']];
  const kind = (s) => (s.kind === 'VENDOR' ? 'vendor' : 'rider');
  const live = (s) => s.payouts.find((p) => p.status === 'INITIATED');

  const generate = async () => {
    const res = await run(() => api.finance.generateSettlements({ ...period, kind: 'ALL' }), { success: (r) => `${r.created} draft settlement${r.created === 1 ? '' : 's'} created`, invalidate: refresh });
    if (res.ok) setResult(res.result);
  };

  return (
    <>
      <PageHeader title="Settlements & payouts" description="Work out what ChopNow owes each restaurant and rider for a finished period, approve it, then record the bank transfer you make." />
      {can('settlement.manage') ? (
        <Card className="mb-5">
          <h2 className="mb-3 text-lg font-bold">Create settlements</h2>
          <div className="flex flex-wrap items-end gap-3">
            <Input label="From (Lagos date)" type="date" value={period.from} max={yesterday} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
            <Input label="To (inclusive)" type="date" value={period.to} max={yesterday} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
            <Button onClick={generate} loading={busy}>Create drafts</Button>
          </div>
          {result?.skipped.length ? (
            <ul className="mt-3 text-sm text-ink-muted">
              {result.skipped.map((s, i) => <li key={i}>Skipped {s.name}: {s.reason}</li>)}
            </ul>
          ) : null}
        </Card>
      ) : null}
      <Card className="mb-4"><FilterChips label="Filter settlements" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[['DRAFT', 'Drafts'], ['APPROVED', 'Approved'], ['PAYOUT_INITIATED', 'Transfer in progress'], ['FAILED', 'Failed'], ['PAID', 'Paid'], ['', 'All']]} /></Card>
      <Card>
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
          <>
            <Table
              columns={[
                { key: 'who', header: 'Payee', render: (s) => <span className="font-semibold">{s.kind === 'VENDOR' ? s.restaurantName : s.riderName} <Badge>{s.kind === 'VENDOR' ? 'Restaurant' : 'Rider'}</Badge></span> },
                { key: 'period', header: 'Period', render: (s) => `${s.from} – ${s.to}` },
                { key: 'work', header: 'Work', render: (s) => (s.kind === 'VENDOR' ? `${s.orderCount} orders` : `${s.deliveryCount} deliveries`) },
                {
                  key: 'calc', header: 'Breakdown',
                  render: (s) => <span className="text-xs text-ink-muted">{s.kind === 'VENDOR' ? <>Sales <Money kobo={s.grossSalesKobo} /> − comm. <Money kobo={s.commissionKobo} />{s.refundDeductionsKobo ? <> − refunds <Money kobo={s.refundDeductionsKobo} /></> : null}</> : <>Earned <Money kobo={s.earningsKobo} />{s.cashOutstandingKobo ? <> · holds cash <Money kobo={s.cashOutstandingKobo} /></> : null}</>}{s.adjustmentsKobo ? <> · carried <Money kobo={s.adjustmentsKobo} /></> : null}</span>,
                },
                { key: 'net', header: 'Pay', align: 'right', render: (s) => <Money kobo={s.netPayableKobo} className={s.netPayableKobo < 0 ? 'font-bold text-bad' : 'font-bold'} /> },
                { key: 'status', header: 'Status', render: (s) => <Status value={s.status} /> },
                {
                  key: 'act', header: '', align: 'right',
                  render: (s) => (
                    <div className="flex flex-wrap justify-end gap-1">
                      {s.status === 'DRAFT' && can('settlement.manage') ? <><Button size="sm" onClick={() => run(() => api.finance.approveSettlement(kind(s), s.id), { success: 'Approved', invalidate: refresh })}>Approve</Button><Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'cancel', s })}>Cancel</Button></> : null}
                      {(s.status === 'APPROVED' || s.status === 'FAILED') && s.netPayableKobo > 0 && can('payout.manage') ? <Button size="sm" onClick={() => run(() => api.finance.startPayout(kind(s), s.id), { success: (r) => `Transfer reference ${r.payouts.at(-1).reference}`, invalidate: refresh })}>Start payout</Button> : null}
                      {s.status === 'PAYOUT_INITIATED' && can('payout.manage') ? <><Button size="sm" onClick={() => setDialog({ kind: 'paid', s })}>Record transfer</Button><Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'fail', s })}>Failed</Button></> : null}
                      {s.status === 'PAYOUT_INITIATED' ? <span className="basis-full text-right text-xs text-ink-muted">Quote {live(s)?.reference}</span> : null}
                      {s.status === 'PAID' ? <span className="text-xs text-ink-muted">bank ref {s.payouts.find((p) => p.status === 'SUCCESSFUL')?.bankReference}</span> : null}
                    </div>
                  ),
                },
              ]}
              rows={list.data.items}
              rowKey={(s) => s.id}
              empty={<EmptyState icon={status === 'PAID' ? Landmark : Wallet} title="No settlements here" />}
            />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ReasonDialog open={dialog?.kind === 'cancel'} title="Cancel this draft?" message="You can create it again for the same period afterwards." confirmLabel="Cancel settlement" destructive onClose={() => setDialog(null)} onSubmit={({ reason }) => run(() => api.finance.cancelSettlement(kind(dialog.s), dialog.s.id, reason), { success: 'Cancelled', invalidate: refresh })} />
      <ReasonDialog
        open={dialog?.kind === 'paid'}
        title="Record the bank transfer"
        message={dialog?.s ? `Only after you have sent ₦${(dialog.s.netPayableKobo / 100).toLocaleString('en-NG')} to ${dialog.s.kind === 'VENDOR' ? dialog.s.restaurantName : dialog.s.riderName}, quoting ${live(dialog.s)?.reference}. This books the money as paid.` : ''}
        fields={[{ name: 'bankReference', label: 'Bank transfer reference', required: true }]}
        requireReason={false}
        confirmLabel="Mark as paid"
        onClose={() => setDialog(null)}
        onSubmit={({ bankReference }) => run(() => api.finance.completePayout(live(dialog.s).id, bankReference.trim()), { success: 'Payout recorded', invalidate: refresh })}
      />
      <ReasonDialog open={dialog?.kind === 'fail'} title="Transfer failed" confirmLabel="Mark as failed" destructive onClose={() => setDialog(null)} onSubmit={({ reason }) => run(() => api.finance.failPayout(live(dialog.s).id, reason), { success: 'Marked failed; you can start a new payout', invalidate: refresh })} />
    </>
  );
}
