import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeliveryPanel } from './DeliveryPanel';
import { OfferCard } from './OfferCard';

// React Native Testing Library 14: render and fireEvent are async.
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = (ui) => render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

const NOW = Date.parse('2026-10-15T12:00:00Z');

const offer = {
  id: 'offer-1',
  deliveryId: 'd1',
  orderCode: 'CN-7K3Q9P',
  expiresAt: new Date(NOW + 45_000).toISOString(),
  restaurant: { name: 'Mama Nkechi’s Kitchen', addressLine: '12 Herbert Macaulay Way', area: 'Yaba', latitude: 6.51, longitude: 3.37 },
  dropoffArea: 'Akoka',
  distanceToRestaurantMeters: 640,
  deliveryDistanceMeters: 1850,
  earningKobo: 40_000,
  cashToCollectKobo: 575_000,
  itemCount: 3,
  estimatedReadyAt: null,
};

const delivery = (over = {}) => ({
  id: 'd1',
  status: 'ASSIGNED',
  orderId: 'o1',
  orderCode: 'CN-7K3Q9P',
  orderStatus: 'PREPARING',
  restaurant: { ...offer.restaurant, phone: '+2348030000001' },
  dropoff: { customerFirstName: 'Ada', line1: '7 Akoka Road', line2: null, area: 'Akoka', city: 'Lagos', landmark: 'Blue gate', instructions: null, contactPhone: '+2348030000002', latitude: 6.52, longitude: 3.38 },
  dropoffArea: 'Akoka',
  customerNote: null,
  items: [{ name: 'Jollof Rice', variantName: 'Large', quantity: 2, extras: ['Chicken'] }],
  paymentMethod: 'CASH_ON_DELIVERY',
  cashToCollectKobo: 575_000,
  earningKobo: 40_000,
  estimatedReadyAt: null,
  foodReady: false,
  pinAttemptsLeft: 5,
  assignedAt: null,
  pickedUpAt: null,
  deliveredAt: null,
  failureReason: null,
  actions: ['arrived', 'picked_up', 'release'],
  ...over,
});

describe('OfferCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('shows earning, cash, drop-off area and a live countdown; buttons call back', async () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    await wrap(<OfferCard offer={offer} onAccept={onAccept} onDecline={onDecline} />);
    expect(screen.getByTestId('offer-earning')).toHaveTextContent('₦400');
    expect(screen.getByText('Collect ₦5,750 cash')).toBeTruthy();
    expect(screen.getByText('Drop-off in Akoka')).toBeTruthy();
    expect(screen.getByText('Yaba · 640 m from you')).toBeTruthy();
    expect(screen.getByTestId('offer-seconds')).toHaveTextContent('45s');
    await act(async () => jest.advanceTimersByTime(5000));
    expect(screen.getByTestId('offer-seconds')).toHaveTextContent('40s');
    await fireEvent.press(screen.getByTestId('accept-offer'));
    expect(onAccept).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('decline-offer'));
    expect(onDecline).toHaveBeenCalled();
  });

  it('disables accepting once the offer has expired', async () => {
    const onAccept = jest.fn();
    await wrap(<OfferCard offer={offer} onAccept={onAccept} onDecline={() => {}} />);
    await act(async () => jest.advanceTimersByTime(46_000));
    expect(screen.getByTestId('offer-seconds')).toHaveTextContent('0s');
    await fireEvent.press(screen.getByTestId('accept-offer'));
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe('DeliveryPanel', () => {
  it('before pickup: restaurant first, pickup disabled until the food is ready', async () => {
    const onAction = jest.fn();
    await wrap(<DeliveryPanel delivery={delivery()} onAction={onAction} />);
    expect(screen.getByTestId('step-title')).toHaveTextContent('Go to Mama Nkechi’s Kitchen');
    await fireEvent.press(screen.getByTestId('action-picked-up'));
    expect(onAction).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('action-arrived'));
    expect(onAction).toHaveBeenCalledWith('arrived');
    expect(screen.queryByTestId('customer-call')).toBeNull();
  });

  it('at the door: validates PIN and cash before completing', async () => {
    const onAction = jest.fn();
    await wrap(<DeliveryPanel delivery={delivery({ status: 'PICKED_UP', orderStatus: 'PICKED_UP', foodReady: false, actions: ['complete', 'report_problem'] })} onAction={onAction} />);
    expect(screen.getByTestId('step-title')).toHaveTextContent('Deliver to Ada');
    expect(screen.getByTestId('customer-call')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('pin-input'), '48');
    await fireEvent.press(screen.getByTestId('complete-delivery'));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the 4-digit PIN from the customer')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('pin-input'), '4821');
    await fireEvent.changeText(screen.getByTestId('cash-input'), '5750');
    await fireEvent.press(screen.getByTestId('complete-delivery'));
    expect(onAction).toHaveBeenCalledWith('complete', { pin: '4821', cash: 575_000 });
  });

  it('shows the server’s PIN error and blocks completion when attempts run out', async () => {
    await wrap(<DeliveryPanel delivery={delivery({ status: 'PICKED_UP', pinAttemptsLeft: 0, actions: ['complete', 'report_problem'] })} onAction={() => {}} completeError="Too many wrong PINs." />);
    expect(screen.getByTestId('complete-error')).toHaveTextContent('Too many wrong PINs.');
    expect(screen.getByTestId('complete-delivery')).toBeDisabled();
  });
});

describe('Cash hand-in sheet', () => {
  const { CashHandInSheet } = require('./CashHandIn');
  it('validates before sending, then sends kobo and the trimmed reference', async () => {
    const onSubmit = jest.fn();
    await wrap(<CashHandInSheet visible availableKobo={870_000} onClose={() => {}} onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('handin-amount'), '9000');
    await fireEvent.changeText(screen.getByTestId('handin-reference'), ' opay-55120 ');
    await fireEvent.press(screen.getByTestId('handin-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('You can declare at most ₦8,700')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('handin-amount'), '8700');
    await fireEvent.press(screen.getByTestId('handin-submit'));
    expect(onSubmit).toHaveBeenCalledWith(870_000, 'opay-55120');
  });
});
