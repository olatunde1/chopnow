jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FoodCard } from './FoodCard';
import { ItemCustomiser } from './ItemCustomiser';

// React Native Testing Library 14: render and fireEvent are async.
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = (ui) => render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

const item = {
  id: 'item-1',
  categoryId: 'c1',
  name: 'Jollof Rice',
  description: 'Smoky party jollof',
  imageUrl: null,
  priceKobo: 250000,
  fromPriceKobo: 250000,
  isAvailable: true,
  prepTimeMinutes: null,
  variants: [
    { id: 'v-reg', name: 'Regular', priceKobo: 250000, isDefault: true, isAvailable: true },
    { id: 'v-lg', name: 'Large', priceKobo: 350000, isDefault: false, isAvailable: true },
  ],
  extras: [
    { id: 'e-plantain', name: 'Plantain', priceKobo: 50000, maxQuantity: 1, isAvailable: true },
    { id: 'e-chicken', name: 'Chicken', priceKobo: 150000, maxQuantity: 2, isAvailable: true },
  ],
};

describe('ItemCustomiser', () => {
  it('updates the total live and sends the chosen configuration', async () => {
    const onAdd = jest.fn();
    await wrap(<ItemCustomiser item={item} visible onClose={() => {}} onAdd={onAdd} canOrder />);
    expect(screen.getByText('Add · ₦2,500')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('variant-Large'));
    await fireEvent.press(screen.getByTestId('extra-Plantain'));
    // Extra steppers are named after the extra, so each control is unambiguous to a screen reader.
    await fireEvent.press(screen.getByLabelText('Increase Chicken'));
    expect(screen.getByText('Add · ₦5,500')).toBeTruthy(); // 3,500 + 500 + 1,500

    await fireEvent.press(screen.getByTestId('add-to-cart'));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        menuItemId: 'item-1',
        variantId: 'v-lg',
        quantity: 1,
        unitPriceKobo: 550000,
        extras: expect.arrayContaining([expect.objectContaining({ id: 'e-plantain', quantity: 1 }), expect.objectContaining({ id: 'e-chicken', quantity: 1 })]),
      }),
    );
  });

  it('cannot add when the restaurant is not taking orders, and says why', async () => {
    const onAdd = jest.fn();
    await wrap(<ItemCustomiser item={item} visible onClose={() => {}} onAdd={onAdd} canOrder={false} unavailableReason="This restaurant is closed right now." />);
    expect(screen.getByText('This restaurant is closed right now.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add-to-cart'));
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('FoodCard', () => {
  const result = (over = {}) => ({
    item: { id: 'i1', name: 'A very long dish name that should never break the card layout on small phones', description: null, imageUrl: null, categoryName: 'Rice', fromPriceKobo: 250000, isAvailable: true, hasVariants: true, hasExtras: true },
    restaurant: { id: 'r1', slug: 'mama', name: "Mama Nkechi's Kitchen", ratingAverage: null, ratingCount: 0, prepTimeMinutes: 25, distanceMeters: 640, deliveryFeeKobo: 50000, isOpenNow: true, isAcceptingOrders: true, deliversToLocation: true },
    orderable: true,
    ...over,
  });

  it('shows the from-price and restaurant', async () => {
    await wrap(<FoodCard result={result()} onPress={() => {}} />);
    expect(screen.getByText('from ₦2,500')).toBeTruthy();
    expect(screen.getByText("Mama Nkechi's Kitchen · Rice")).toBeTruthy();
    expect(screen.queryByText('Sold out')).toBeNull();
  });

  it('labels unavailable results instead of presenting them as orderable', async () => {
    await wrap(<FoodCard result={result({ orderable: false, restaurant: { ...result().restaurant, isOpenNow: false, isAcceptingOrders: false } })} onPress={() => {}} />);
    expect(screen.getByText('Closed now')).toBeTruthy();
  });
});

describe('ReviewForm', () => {
  const { ReviewForm } = require('./ReviewForm');

  it('needs a rating, then sends the rating and trimmed comment', async () => {
    const onSubmit = jest.fn(async () => {});
    await wrap(<ReviewForm restaurantName="Mama Put" onSubmit={onSubmit} />);
    await fireEvent.press(screen.getByTestId('send-review'));
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('star-4'));
    expect(screen.getByText('Good')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('review-comment'), '  Hot and fast  ');
    await fireEvent.press(screen.getByTestId('send-review'));
    expect(onSubmit).toHaveBeenCalledWith({ restaurantRating: 4, comment: 'Hot and fast' });
  });

  it('shows the error when sending fails', async () => {
    await wrap(<ReviewForm restaurantName="Mama Put" onSubmit={async () => Promise.reject(new Error('This order has already been reviewed'))} />);
    await fireEvent.press(screen.getByTestId('star-2'));
    await fireEvent.press(screen.getByTestId('send-review'));
    expect(await screen.findByText('This order has already been reviewed')).toBeTruthy();
  });
});

describe('ReviewForm with a rider', () => {
  const { ReviewForm } = require('./ReviewForm');

  it('sends an optional rider rating alongside the restaurant rating', async () => {
    const onSubmit = jest.fn(async () => {});
    await wrap(<ReviewForm restaurantName="Mama Put" riderName="Chinedu" onSubmit={onSubmit} />);
    expect(screen.getByText('And Chinedu, your rider? (optional)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('star-5'));
    await fireEvent.press(screen.getByTestId('send-review'));
    expect(onSubmit).toHaveBeenLastCalledWith({ restaurantRating: 5 });
    await fireEvent.press(screen.getByTestId('rider-star-3'));
    await fireEvent.press(screen.getByTestId('send-review'));
    expect(onSubmit).toHaveBeenLastCalledWith({ restaurantRating: 5, riderRating: 3 });
  });
});
