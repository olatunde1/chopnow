import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, Modal, Money, PageHeader, Table } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useSession } from '../state/session';

export const SETTLEMENT_STATUS = {
  APPROVED: ['Approved', 'info'],
  PAYOUT_INITIATED: ['Transfer in progress', 'warn'],
  PAID: ['Paid', 'ok'],
  FAILED: ['Transfer failed', 'bad'],
};

const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
export const periodLabel = (s) => (s.from === s.to ? dayLabel(s.from) : `${dayLabel(s.from)} – ${dayLabel(s.to)}`);

/** Restaurant statements: what ChopNow owes for each period and how it was paid. */
export function PayoutsPage() {
  const { restaurant } = useSession();
  const [selected, setSelected] = useState(null);
  const q = useQuery({ queryKey: ['settlements', restaurant.id], queryFn: () => api.finance.settlements(restaurant.id) });

  const columns = [
    { key: 'period', header: 'Period', render: (s) => <span className="font-semibold">{periodLabel(s)}</span> },
    { key: 'orders', header: 'Orders', align: 'right', render: (s) => s.orderCount },
    { key: 'gross', header: 'Food sales', align: 'right', render: (s) => <Money kobo={s.grossSalesKobo} /> },
    { key: 'net', header: 'You receive', align: 'right', render: (s) => <Money kobo={s.netPayableKobo} className="font-semibold" /> },
    {
      key: 'status',
      header: 'Status',
      render: (s) => {
        const [label, tone] = SETTLEMENT_STATUS[s.status] ?? [s.status, 'neutral'];
        return <Badge tone={tone}>{s.netPayableKobo <= 0 && s.status === 'APPROVED' ? 'Nothing to pay' : label}</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader title="Payouts" description="Statements for each settlement period. ChopNow pays by bank transfer after approving a statement." />
      <Card>
        {q.isPending ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ) : (
          <Table
            columns={columns}
            rows={q.data.items}
            rowKey={(s) => s.id}
            onRowClick={setSelected}
            empty={<EmptyState icon={Landmark} title="No statements yet" message="Statements appear here once ChopNow approves a settlement period." />}
          />
        )}
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Statement ${periodLabel(selected)}` : ''}>
        {selected ? <Statement s={selected} /> : null}
      </Modal>
    </>
  );
}

export function Statement({ s }) {
  const rows = [
    ['Delivered orders', s.orderCount, false],
    ['Food sales', s.grossSalesKobo, true],
    ['ChopNow commission', -s.commissionKobo, true],
    ['Discounts you funded', -s.restaurantFundedDiscountKobo, true],
    ['Refunds charged to you', -s.refundDeductionsKobo, true],
    ['Carried from earlier periods', s.adjustmentsKobo, true],
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-1 text-sm">
        {rows.map(([label, value, money]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right">{money ? <Money kobo={value} /> : value}</dd>
          </div>
        ))}
        <dt className="border-t border-line pt-2 font-bold">You receive</dt>
        <dd className="border-t border-line pt-2 text-right font-bold">
          <Money kobo={s.netPayableKobo} />
        </dd>
      </dl>
      {s.note ? <p className="rounded-xl bg-warn-soft p-3 text-sm">{s.note}</p> : null}
      <div>
        <h3 className="mb-2 font-bold">Transfers</h3>
        {s.payouts.length === 0 ? (
          <p className="text-sm text-ink-muted">{s.netPayableKobo > 0 ? 'Not sent yet.' : 'Nothing to transfer for this period.'}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {s.payouts.map((p) => (
              <li key={p.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.reference}</span>
                  <Badge tone={p.status === 'SUCCESSFUL' ? 'ok' : p.status === 'FAILED' ? 'bad' : 'warn'}>{p.status === 'SUCCESSFUL' ? 'Paid' : p.status === 'FAILED' ? 'Failed' : 'In progress'}</Badge>
                  <Money kobo={p.amountKobo} className="ml-auto font-semibold" />
                </div>
                <p className="text-ink-muted">
                  {p.completedAt ? `Paid ${dateTime(p.completedAt)}${p.bankReference ? ` · bank ref ${p.bankReference}` : ''}` : p.failureReason ? p.failureReason : `Started ${dateTime(p.initiatedAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-ink-muted">Questions about a statement? Contact ChopNow support with the period and transfer reference.</p>
    </div>
  );
}
