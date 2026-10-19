import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { PaystackProvider } from '../src/modules/payments/paystack.js';
import { PaymentProviderError } from '../src/modules/payments/provider.js';

const SECRET = 'sk_test_0123456789abcdefghij';
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('Paystack adapter', () => {
  it('initialises in kobo with the secret only in the Authorization header', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { status: true, message: 'ok', data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'CN-1' } }));
    const p = new PaystackProvider(SECRET, 'https://api.paystack.co', fetchImpl);
    const res = await p.initialize({ reference: 'CN-1', amountKobo: 575_000, email: 'ada@example.com', callbackUrl: 'https://api/cb', metadata: { orderId: 'o1' } });
    expect(res.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body)).toMatchObject({ amount: 575_000, currency: 'NGN', reference: 'CN-1', email: 'ada@example.com' });
    expect(init.body).not.toContain(SECRET);
  });

  it('maps verification results', async () => {
    const make = (status: string) =>
      new PaystackProvider(SECRET, 'https://x', async () => reply(200, { status: true, message: 'ok', data: { id: 9, status, amount: 575_000, currency: 'NGN', channel: 'card', paid_at: '2026-10-14T11:00:00Z', gateway_response: 'Approved', reference: 'CN-1' } }));
    expect((await make('success').verify('CN-1')).status).toBe('success');
    expect((await make('failed').verify('CN-1')).status).toBe('failed');
    expect((await make('reversed').verify('CN-1')).status).toBe('failed');
    expect((await make('abandoned').verify('CN-1')).status).toBe('abandoned');
    expect((await make('ongoing').verify('CN-1')).status).toBe('pending');
    const ok = await make('success').verify('CN-1');
    expect(ok).toMatchObject({ amountKobo: 575_000, currency: 'NGN', providerTransactionId: '9', channel: 'card' });
  });

  it('creates refunds against our transaction reference, in kobo, and maps their status', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { status: true, message: 'Refund has been queued for processing', data: { id: 3018284, status: 'pending' } }));
    const p = new PaystackProvider(SECRET, 'https://api.paystack.co', fetchImpl);
    const res = await p.refund({ transactionReference: 'CN-7K3Q9P', amountKobo: 120_000, refundId: 'r1' });
    expect(res).toEqual({ status: 'pending', providerRefundId: '3018284', message: 'pending' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe('https://api.paystack.co/refund');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ transaction: 'CN-7K3Q9P', amount: 120_000, merchant_note: 'ChopNow refund r1' });

    const fetchOne = (status: string) => new PaystackProvider(SECRET, 'https://x', async () => reply(200, { status: true, message: 'ok', data: { id: 7, status } })).fetchRefund('7');
    expect((await fetchOne('processed')).status).toBe('success');
    expect((await fetchOne('failed')).status).toBe('failed');
    expect((await fetchOne('processing')).status).toBe('pending');
    const refused = new PaystackProvider(SECRET, 'https://x', async () => reply(400, { status: false, message: 'Refund amount cannot be more than transaction amount' }));
    await expect(refused.refund({ transactionReference: 'CN-1', amountKobo: 9, refundId: 'r' })).rejects.toThrow(/cannot be more/);
  });

  it('treats "reference not found" as not paid yet, but surfaces auth and server errors', async () => {
    const notFound = new PaystackProvider(SECRET, 'https://x', async () => reply(400, { status: false, message: 'Transaction reference not found' }));
    expect((await notFound.verify('CN-1')).status).toBe('pending');
    const badKey = new PaystackProvider(SECRET, 'https://x', async () => reply(401, { status: false, message: 'Invalid key' }));
    await expect(badKey.verify('CN-1')).rejects.toBeInstanceOf(PaymentProviderError);
    const down = new PaystackProvider(SECRET, 'https://x', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(down.initialize({ reference: 'r', amountKobo: 1, email: 'a@b.c', callbackUrl: 'x', metadata: {} })).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('verifies webhook signatures over the exact raw body', () => {
    const p = new PaystackProvider(SECRET);
    const raw = Buffer.from('{"event":"charge.success","data":{"id":1,"reference":"CN-1"}}');
    const sig = createHmac('sha512', SECRET).update(raw).digest('hex');
    expect(p.verifyWebhookSignature(raw, { 'x-paystack-signature': sig })).toBe(true);
    expect(p.verifyWebhookSignature(Buffer.from(raw.toString().replace('CN-1', 'CN-2')), { 'x-paystack-signature': sig })).toBe(false);
    expect(p.verifyWebhookSignature(raw, { 'x-paystack-signature': 'nothex' })).toBe(false);
    expect(p.verifyWebhookSignature(raw, {})).toBe(false);
    expect(p.parseWebhook(JSON.parse(raw.toString()))).toEqual({ event: 'charge.success', reference: 'CN-1', dedupeKey: 'charge.success:1' });
  });
});

describe('payment configuration', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@h/db_test', JWT_ACCESS_SECRET: 'x'.repeat(40) };
  it('refuses the mock provider in staging and production', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'production', PAYMENT_PROVIDER: 'mock' })).toThrow(/mock payment provider/);
    expect(() => loadConfig({ ...base, APP_ENV: 'staging' })).toThrow(/mock payment provider/);
  });
  it('requires a valid Paystack key and keeps live keys out of non-production', () => {
    expect(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'paystack' })).toThrow(/PAYSTACK_SECRET_KEY/);
    expect(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_live_0123456789abcdef' })).toThrow(/live keys/);
    expect(loadConfig({ ...base, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: SECRET }).PAYMENT_PROVIDER).toBe('paystack');
  });
});
