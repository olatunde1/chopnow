import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Statement, periodLabel } from './PayoutsPage';

const settlement = (over = {}) => ({
  id: 's1',
  kind: 'VENDOR',
  from: '2026-10-12',
  to: '2026-10-18',
  status: 'PAID',
  orderCount: 12,
  grossSalesKobo: 4_200_000,
  commissionKobo: 630_000,
  restaurantFundedDiscountKobo: 0,
  refundDeductionsKobo: 120_000,
  adjustmentsKobo: -40_000,
  netPayableKobo: 3_410_000,
  note: null,
  payouts: [
    { id: 'p1', reference: 'PO-AB12CD34', amountKobo: 3_410_000, status: 'FAILED', failureReason: 'Account name mismatch', bankReference: null, initiatedAt: '2026-10-19T09:00:00Z', completedAt: null },
    { id: 'p2', reference: 'PO-EF56GH78', amountKobo: 3_410_000, status: 'SUCCESSFUL', failureReason: null, bankReference: 'NIP-0001', initiatedAt: '2026-10-19T10:00:00Z', completedAt: '2026-10-19T10:30:00Z' },
  ],
  ...over,
});

describe('restaurant statements', () => {
  it('labels the period in Lagos dates', () => {
    expect(periodLabel({ from: '2026-10-12', to: '2026-10-18' })).toBe('12 Oct – 18 Oct');
    expect(periodLabel({ from: '2026-10-14', to: '2026-10-14' })).toBe('14 Oct');
  });

  it('shows how the amount was worked out and every transfer attempt', () => {
    render(<Statement s={settlement()} />);
    expect(screen.getByText('Refunds charged to you').nextSibling).toHaveTextContent('-₦1,200');
    expect(screen.getByText('Carried from earlier periods').nextSibling).toHaveTextContent('-₦400');
    expect(screen.getByText('You receive').nextSibling).toHaveTextContent('₦34,100');
    expect(screen.getByText('Account name mismatch')).toBeInTheDocument();
    expect(screen.getByText(/bank ref NIP-0001/)).toBeInTheDocument();
  });

  it('explains a period with nothing to pay', () => {
    render(<Statement s={settlement({ netPayableKobo: -40_000, status: 'APPROVED', payouts: [], note: 'Negative balance: carried forward to the next settlement' })} />);
    expect(screen.getByText('Nothing to transfer for this period.')).toBeInTheDocument();
    expect(screen.getByText(/carried forward/)).toBeInTheDocument();
  });
});
