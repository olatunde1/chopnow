import { RegisterRequestSchema } from '@chopnow/shared-schemas';
import { distanceLabel, mapsUrl, secondsLeft, stepFor, validateCompletion } from './delivery';
import { toRegistration } from './forms';

const cashDelivery = { status: 'PICKED_UP', cashToCollectKobo: 575_000, orderCode: 'CN-7K3Q9P', foodReady: true, restaurant: { name: 'Mama Nkechi' }, dropoff: { customerFirstName: 'Ada' } };

describe('completion form', () => {
  it('needs a 4-digit PIN', () => {
    expect(validateCompletion({ pin: '12', cashText: '5750' }, cashDelivery).errors.pin).toMatch(/4-digit/);
    expect(validateCompletion({ pin: '12a4', cashText: '5750' }, cashDelivery).ok).toBe(false);
  });

  it('turns the cash typed in naira into exact kobo and insists on the full amount', () => {
    expect(validateCompletion({ pin: '4821', cashText: '5,750' }, cashDelivery)).toEqual({ ok: true, errors: {}, cashCollectedKobo: 575_000 });
    expect(validateCompletion({ pin: '4821', cashText: '₦5750.00' }, cashDelivery).cashCollectedKobo).toBe(575_000);
    expect(validateCompletion({ pin: '4821', cashText: '5000' }, cashDelivery).errors.cash).toMatch(/Collect exactly ₦5,750/);
    expect(validateCompletion({ pin: '4821', cashText: 'five' }, cashDelivery).errors.cash).toMatch(/Enter the cash/);
    expect(validateCompletion({ pin: '4821', cashText: '' }, cashDelivery).ok).toBe(false);
  });

  it('sends no cash for online-paid orders', () => {
    const online = { ...cashDelivery, cashToCollectKobo: 0 };
    expect(validateCompletion({ pin: '4821', cashText: '' }, online)).toEqual({ ok: true, errors: {}, cashCollectedKobo: undefined });
  });
});

describe('delivery steps', () => {
  it('tells the rider what to do next at each stage', () => {
    expect(stepFor({ ...cashDelivery, status: 'ASSIGNED' }).title).toBe('Go to Mama Nkechi');
    expect(stepFor({ ...cashDelivery, status: 'ARRIVED_AT_RESTAURANT', foodReady: false }).hint).toMatch(/Waiting for the restaurant/);
    expect(stepFor(cashDelivery)).toMatchObject({ title: 'Deliver to Ada', hint: expect.stringMatching(/Collect ₦5,750 in cash/) });
    expect(stepFor({ ...cashDelivery, cashToCollectKobo: 0 }).hint).toMatch(/don’t collect any cash/);
  });
});

describe('helpers', () => {
  it('formats distances and countdowns', () => {
    expect(distanceLabel(null)).toBeNull();
    expect(distanceLabel(347)).toBe('350 m');
    expect(distanceLabel(2440)).toBe('2.4 km');
    expect(secondsLeft('2026-10-15T12:00:45Z', Date.parse('2026-10-15T12:00:00Z'))).toBe(45);
    expect(secondsLeft('2026-10-15T12:00:45Z', Date.parse('2026-10-15T12:01:00Z'))).toBe(0);
  });

  it('builds directions from coordinates, or from the address when there are none', () => {
    expect(mapsUrl({ latitude: 6.5175, longitude: 3.3691 })).toBe('https://www.google.com/maps/dir/?api=1&destination=6.5175%2C3.3691');
    expect(mapsUrl({ latitude: null, line1: '12 Akoka Rd', area: 'Yaba' })).toContain(encodeURIComponent('12 Akoka Rd, Yaba, Lagos'));
  });

  it('registration payload passes the API schema for riders', () => {
    const form = { fullName: 'Kunle Ade', email: 'kunle@example.com', phone: '0803 222 0009', password: 'ride2026', vehicleType: 'MOTORCYCLE', vehiclePlate: ' lag-123-ab ' };
    const payload = toRegistration(form);
    expect(payload.rider).toEqual({ vehicleType: 'MOTORCYCLE', vehiclePlate: 'LAG-123-AB' });
    expect(RegisterRequestSchema.safeParse(payload).success).toBe(true);
    expect(RegisterRequestSchema.safeParse(toRegistration({ ...form, phone: '' })).success).toBe(false);
  });
});

describe('cash hand-in form', () => {
  const { validateHandIn } = require('./delivery');
  it('accepts naira up to what can still be declared, with a reference', () => {
    expect(validateHandIn({ amountText: '8,700', reference: 'OPAY-55120' }, 1_445_000)).toEqual({ ok: true, errors: {}, amountKobo: 870_000 });
    expect(validateHandIn({ amountText: '14450.01', reference: 'OPAY-1' }, 1_445_000).errors.amount).toMatch(/at most ₦14,450/);
    expect(validateHandIn({ amountText: '0', reference: 'OPAY-1' }, 1_445_000).errors.amount).toMatch(/Enter the amount/);
    expect(validateHandIn({ amountText: '500', reference: ' ' }, 1_445_000).errors.reference).toMatch(/reference/);
  });
});
