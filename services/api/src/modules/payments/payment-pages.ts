import express, { Router } from 'express';
import { formatMinor } from '@chopnow/shared-utils';
import type { Db } from '../../db/client.js';
import type { MockPaymentProvider } from './mock.js';
import type { PaymentsService } from './payments.service.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string, banner?: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#FFF8EF;color:#1F1A17}
main{max-width:420px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 3px 10px rgba(59,42,26,.08)}
h1{font-size:22px;margin:0 0 8px} p{line-height:1.5;color:#5F5650}
.banner{background:#FEF3C7;color:#B45309;font-weight:700;padding:12px 16px;border-radius:12px;margin-bottom:16px}
button,.btn{display:block;width:100%;min-height:48px;border-radius:12px;border:0;font-size:16px;font-weight:600;margin-top:12px;cursor:pointer;text-align:center;line-height:48px;text-decoration:none}
.primary{background:#C2410C;color:#fff}.secondary{background:#FEE2E2;color:#B91C1C}.ghost{background:#FFEDD5;color:#9A3412}
.amount{font-size:28px;font-weight:800;color:#1F1A17;margin:8px 0}
</style></head><body><main>${banner ? `<div class="banner">${esc(banner)}</div>` : ''}<div class="card">${body}</div></main></body></html>`;
}

/**
 * Browser pages around payment (not JSON API routes):
 * - GET /v1/payments/callback: where Paystack returns the customer. Verifies with Paystack, then
 *   tells the customer to go back to the app (which also re-checks).
 * - Mock checkout pages (development/test only): simulate success or failure without real money.
 */
export function paymentPages(payments: PaymentsService, db: Db, mock: MockPaymentProvider | null) {
  const router = Router();

  router.get('/v1/payments/callback', async (req, res) => {
    const reference = String(req.query.reference ?? req.query.trxref ?? '');
    const result = /^[A-Z0-9-]{4,40}$/.test(reference) ? await payments.callbackResult(reference) : null;
    const ok = result?.status === 'SUCCESSFUL';
    res
      .status(200)
      .type('html')
      .send(
        page(
          ok ? 'Payment received' : 'Payment status',
          `<h1>${ok ? 'Payment received' : 'Almost there'}</h1><p>${esc(result?.message ?? 'We’re confirming your payment.')}</p><p>You can close this page and return to the ChopNow app.</p>${result ? `<a class="btn primary" href="chopnow://orders/${esc(result.orderId)}">Open ChopNow</a>` : ''}`,
        ),
      );
  });

  if (mock) {
    const banner = 'TEST PAYMENT — development only. No real money is charged.';
    router.get('/v1/payments/mock/checkout/:reference', async (req, res) => {
      const payment = await db.payment.findUnique({ where: { reference: req.params.reference }, include: { order: { select: { code: true } } } });
      if (!payment || payment.provider !== 'MOCK') {
        res.status(404).type('html').send(page('Not found', '<h1>Payment not found</h1>', banner));
        return;
      }
      const ref = esc(payment.reference);
      res
        .type('html')
        .send(
          page(
            'Test checkout',
            `<h1>ChopNow test checkout</h1><p>Order ${esc(payment.order.code)} · reference ${ref}</p><div class="amount">${esc(formatMinor(payment.amountKobo, { showKobo: true }))}</div>
<form method="post" action="/v1/payments/mock/checkout/${ref}"><input type="hidden" name="outcome" value="success"><button class="primary" type="submit">Simulate successful payment</button></form>
<form method="post" action="/v1/payments/mock/checkout/${ref}"><input type="hidden" name="outcome" value="failed"><button class="secondary" type="submit">Simulate failed payment</button></form>`,
            banner,
          ),
        );
    });

    router.post('/v1/payments/mock/checkout/:reference', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
      const outcome = req.body?.outcome === 'success' ? 'success' : 'failed';
      const reference = req.params.reference;
      if (!mock.complete(reference, outcome)) {
        res.status(404).type('html').send(page('Not found', '<h1>Payment not found</h1>', banner));
        return;
      }
      // Deliver a signed webhook exactly as a real provider would, through the same code path.
      const { raw, signature } = mock.signedWebhook(reference, outcome === 'success' ? 'charge.success' : 'charge.failed');
      await payments.handleWebhook(raw, { 'x-mock-signature': signature }, JSON.parse(raw.toString('utf8'))).catch(() => undefined);
      const payment = await db.payment.findUnique({ where: { reference } });
      res
        .type('html')
        .send(
          page(
            'Test payment complete',
            `<h1>${outcome === 'success' ? 'Test payment succeeded' : 'Test payment failed'}</h1><p>Return to the ChopNow app to continue.</p>${payment ? `<a class="btn ghost" href="chopnow://orders/${esc(payment.orderId)}">Open ChopNow</a>` : ''}`,
            banner,
          ),
        );
    });
  }

  return router;
}
