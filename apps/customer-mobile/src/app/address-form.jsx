import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AddressInputSchema } from '@chopnow/shared-schemas';
import { Button, Text, TextField, useToast } from '../components/ui';
import { api } from '../lib/api';
import { PILOT_AREA } from '../lib/config';
import { getDeviceCoordinates } from '../lib/device-location';
import { apiFormErrors, zodFieldErrors } from '../lib/forms';
import { useAddresses } from '../lib/hooks';
import { goBack } from '../lib/navigation';
import { useDeliveryLocation } from '../state/location';
import { colors, radius, spacing } from '../theme/tokens';

const EMPTY = { label: 'Home', line1: '', line2: '', area: '', city: 'Sagamu', landmark: '', contactPhone: '', instructions: '' };

/**
 * Add or edit a delivery address. A map pin is required because delivery eligibility and fees are
 * computed from coordinates; the customer sets it from GPS (or, for testing, the pilot-area centre).
 */
export default function AddressFormScreen() {
  const { id } = useLocalSearchParams();
  const editing = typeof id === 'string';
  const addresses = useAddresses();
  const queryClient = useQueryClient();
  const toast = useToast();
  const setLocation = useDeliveryLocation((s) => s.setLocation);
  const [form, setForm] = useState(EMPTY);
  const [coords, setCoords] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!editing) return;
    const a = addresses.data?.items.find((x) => x.id === id);
    if (a) {
      setForm({ label: a.label, line1: a.line1, line2: a.line2 ?? '', area: a.area, city: a.city, landmark: a.landmark ?? '', contactPhone: a.contactPhone ?? '', instructions: a.instructions ?? '' });
      setCoords(a.latitude !== null ? { latitude: a.latitude, longitude: a.longitude, source: 'saved' } : null);
    }
  }, [editing, id, addresses.data]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const setPin = (pin) => {
    setCoords(pin);
    setErrors(({ pin: _cleared, latitude: _lat, longitude: _lng, ...rest }) => rest);
  };

  const pinDevice = async () => {
    setLocating(true);
    try {
      setPin({ ...(await getDeviceCoordinates()), source: 'device' });
    } catch (e) {
      toast.show(e.message, 'danger');
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    setMessage(null);
    const input = {
      ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== '')),
      ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
    };
    const parsed = AddressInputSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrs = zodFieldErrors(parsed);
      if (fieldErrs.latitude || fieldErrs.longitude) fieldErrs.pin = 'Set the map pin for this address.';
      setErrors(fieldErrs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = editing ? await api.addresses.update(id, input) : await api.addresses.create(input);
      await queryClient.invalidateQueries({ queryKey: ['me', 'addresses'] });
      if (!editing) {
        setLocation({ latitude: saved.latitude, longitude: saved.longitude, label: `${saved.label} · ${saved.line1}`, source: 'address', addressId: saved.id });
      }
      toast.show(editing ? 'Address updated' : 'Address saved', 'success');
      goBack('/addresses');
    } catch (err) {
      const { fields, message: m } = apiFormErrors(err);
      setErrors(fields);
      setMessage(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: editing ? 'Edit address' : 'New address' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {message ? (
          <View style={styles.alert} accessibilityRole="alert">
            <Text tone="danger">{message}</Text>
          </View>
        ) : null}

        <View style={[styles.pin, errors.pin && { borderColor: colors.danger }]}>
          <Ionicons name={coords ? 'location' : 'location-outline'} size={24} color={coords ? colors.success : colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{coords ? 'Map pin set' : 'Map pin needed'}</Text>
            <Text variant="caption" tone={errors.pin ? 'danger' : 'muted'}>
              {errors.pin ?? (coords ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}${coords.source === 'area' ? ' (approximate)' : ''}` : 'Stand at the address and use your location.')}
            </Text>
          </View>
        </View>
        <View style={styles.pinActions}>
          <Button title="Use my location" icon="navigate" variant="secondary" onPress={pinDevice} loading={locating} style={{ flex: 1 }} />
          <Button
            title="Pilot area"
            icon="map-outline"
            variant="outline"
            onPress={() => setPin({ latitude: PILOT_AREA.latitude, longitude: PILOT_AREA.longitude, source: 'area' })}
            style={{ flex: 1 }}
          />
        </View>

        <TextField label="Label" value={form.label} onChangeText={set('label')} error={errors.label} placeholder="Home, Work…" />
        <TextField label="Street address" value={form.line1} onChangeText={set('line1')} error={errors.line1} placeholder="12 Sabo Road" testID="line1" />
        <TextField label="Flat, floor or building (optional)" value={form.line2} onChangeText={set('line2')} error={errors.line2} />
        <View style={styles.twoCol}>
          <TextField label="Area" value={form.area} onChangeText={set('area')} error={errors.area} style={{ flex: 1 }} />
          <TextField label="City" value={form.city} onChangeText={set('city')} error={errors.city} style={{ flex: 1 }} />
        </View>
        <TextField label="Landmark (optional)" value={form.landmark} onChangeText={set('landmark')} error={errors.landmark} placeholder="Opposite the pharmacy" />
        <TextField label="Contact phone (optional)" value={form.contactPhone} onChangeText={set('contactPhone')} error={errors.contactPhone} keyboardType="phone-pad" />
        <TextField label="Delivery instructions (optional)" value={form.instructions} onChangeText={set('instructions')} error={errors.instructions} multiline />
        <Button title={editing ? 'Save changes' : 'Save address'} onPress={submit} loading={busy} fullWidth testID="save-address" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
  alert: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  pin: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  pinActions: { flexDirection: 'row', gap: spacing.sm },
  twoCol: { flexDirection: 'row', gap: spacing.md },
});
