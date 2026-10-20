jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { PILOT_AREA } from '../lib/config';
import { rehydrateLocation } from './location';

describe('saved delivery location', () => {
  it('moves a saved pilot-area choice to the current pilot area (e.g. the old Yaba spot becomes Sagamu)', () => {
    const old = { location: { latitude: 6.5095, longitude: 3.3711, label: 'Yaba, Lagos (pilot area)', source: 'area' } };
    expect(rehydrateLocation(old).location).toEqual({ latitude: PILOT_AREA.latitude, longitude: PILOT_AREA.longitude, label: PILOT_AREA.label, source: 'area' });
  });

  it("keeps the customer's own saved address and GPS position as they are", () => {
    const address = { location: { latitude: 6.85, longitude: 3.64, label: 'Home · 12 Sabo Road', source: 'address', addressId: 'a1' } };
    const device = { location: { latitude: 6.83, longitude: 3.66, label: 'Current location', source: 'device' } };
    expect(rehydrateLocation(address)).toEqual(address);
    expect(rehydrateLocation(device)).toEqual(device);
    expect(rehydrateLocation(undefined)).toEqual({ location: null });
  });
});
