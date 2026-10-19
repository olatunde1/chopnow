import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hasPermission } from '@chopnow/shared-schemas';
import { navFor } from './components/AppShell';
import { ReasonDialog, Status } from './components/admin';
import { ToastProvider } from './components/ui';
import { toPromotionPayload } from './pages/ConfigPages';

vi.mock('./lib/api', async (orig) => {
  const real = await orig();
  return { ...real, api: { ...real.api, users: { ...real.api.users, createStaff: vi.fn(async () => ({ user: { id: 'u1', fullName: 'Kemi Ops' }, temporaryPassword: 'Ab3dEf7hJk9mNp2q' })) } } };
});
const { CreateStaff } = await import('./pages/PeoplePages');

const wrap = (ui) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
const menu = (role) => navFor((p) => hasPermission(role, p)).filter((i) => i.to).map((i) => i.label);

describe('menu by role', () => {
  it('support sees operations tools but no finance actions or settings', () => {
    const m = menu('SUPPORT');
    expect(m).toEqual(expect.arrayContaining(['Dashboard', 'Orders', 'Restaurants', 'Riders', 'Customers & staff', 'Reviews', 'Refunds']));
    expect(m).not.toEqual(expect.arrayContaining(['Settlements & payouts']));
    expect(m).not.toContain('Business rules');
    expect(m).not.toContain('Dispatch');
  });

  it('finance sees money, not dispatch or promotions; admins see everything', () => {
    const f = menu('FINANCE');
    expect(f).toEqual(expect.arrayContaining(['Summary', 'Refunds', 'Rider cash', 'Settlements & payouts', 'Audit log']));
    expect(f).not.toContain('Dispatch');
    expect(f).not.toContain('Promotions');
    expect(menu('ADMIN')).toHaveLength(14);
    expect(menu('OPERATIONS')).toEqual(expect.arrayContaining(['Dispatch', 'Promotions']));
    expect(menu('CUSTOMER')).toEqual([]);
  });

  it('section headings appear only above sections the role can use', () => {
    const items = navFor((p) => hasPermission('FINANCE', p));
    expect(items.filter((i) => i.section).map((i) => i.section)).toEqual(['Operations', 'Finance', 'Admin']);
  });
});

describe('status labels', () => {
  it('reads plainly and never shows raw enum values', () => {
    render(<><Status value="DELIVERY_EXCEPTION" /><Status value="PAYOUT_INITIATED" /><Status value="ACCEPTED" kind="document" /><Status value="SOMETHING_NEW" /></>);
    expect(screen.getByText('Delivery problem')).toBeInTheDocument();
    expect(screen.getByText('Transfer in progress')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('something new')).toBeInTheDocument();
  });
});

describe('reason dialog', () => {
  it('requires a real reason, passes extra fields, and stays open with the server error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ ok: false, message: 'That rider is already on another delivery.' }));
    wrap(<ReasonDialog open title="Assign" confirmLabel="Assign" fields={[{ name: 'riderId', label: 'Rider', type: 'select', required: true, options: [['r1', 'Chinedu']] }]} onClose={() => {}} onSubmit={onSubmit} />);
    const confirm = screen.getByRole('button', { name: 'Assign' });
    expect(confirm).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Rider'), 'r1');
    await user.type(screen.getByLabelText(/Reason/), 'ok');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), ' by phone');
    await user.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith({ riderId: 'r1', reason: 'ok by phone' });
    expect(await screen.findByRole('alert')).toHaveTextContent('already on another delivery');
  });
});

describe('promotion form', () => {
  it('converts naira, percent and Lagos dates for the API', () => {
    const payload = toPromotionPayload({ code: ' mama20 ', description: ' Mama week ', type: 'PERCENT_OFF', percent: '12.5', maxDiscount: '1,000', amount: '', minSubtotal: '2500', restaurantId: 'r1', fundedBy: 'RESTAURANT', starts: '2026-10-19', ends: '2026-10-25', usageLimit: '', perCustomerLimit: '2' });
    expect(payload).toEqual({
      code: 'mama20', description: 'Mama week', type: 'PERCENT_OFF', percentBps: 1250, maxDiscountKobo: 100_000, minSubtotalKobo: 250_000, restaurantId: 'r1', fundedBy: 'RESTAURANT',
      startsAt: '2026-10-18T23:00:00.000Z', endsAt: '2026-10-25T22:59:59.000Z', perCustomerLimit: 2,
    });
    expect(toPromotionPayload({ code: 'FREE', description: 'Free delivery', type: 'FREE_DELIVERY', minSubtotal: '', fundedBy: 'PLATFORM', starts: '2026-10-19', ends: '2026-10-19', perCustomerLimit: '' })).toMatchObject({ minSubtotalKobo: 0, perCustomerLimit: 1 });
  });
});

describe('new staff account', () => {
  it('shows the one-time password once, after creation', async () => {
    const user = userEvent.setup();
    wrap(<CreateStaff onClose={() => {}} />);
    await user.type(screen.getByLabelText('Full name'), 'Kemi Ops');
    await user.type(screen.getByLabelText('Work email'), 'kemi@chopnow.ng');
    await user.selectOptions(screen.getByLabelText('Role'), 'OPERATIONS');
    expect(screen.queryByTestId('temp-password')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByTestId('temp-password')).toHaveTextContent('Ab3dEf7hJk9mNp2q'));
    const { api } = await import('./lib/api');
    expect(api.users.createStaff).toHaveBeenCalledWith({ fullName: 'Kemi Ops', email: 'kemi@chopnow.ng', role: 'OPERATIONS' });
  });
});
