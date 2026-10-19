import * as Location from 'expo-location';

/**
 * Asks for foreground location permission and returns { latitude, longitude }.
 * Throws an Error with a user-facing message when permission is denied or the fix fails.
 */
export async function getDeviceCoordinates() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission was not given. You can pick a saved address or the pilot area instead.');
  }
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) };
  } catch {
    throw new Error('We couldn’t get your location. Check that location services are on and try again.');
  }
}
