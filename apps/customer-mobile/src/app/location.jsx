import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Skeleton, Text, useToast } from '../components/ui';
import { PILOT_AREA } from '../lib/config';
import { getDeviceCoordinates } from '../lib/device-location';
import { useAddresses } from '../lib/hooks';
import { goBack } from '../lib/navigation';
import { useAuth } from '../state/auth';
import { pilotAreaLocation, useDeliveryLocation } from '../state/location';
import { colors, radius, spacing, touchTarget } from '../theme/tokens';

function Option({ icon, title, subtitle, selected, onPress, testID }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      aria-checked={!!selected}
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected && styles.selected, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
    </Pressable>
  );
}

/** Choose where to deliver: GPS, a saved address, or the pilot area centre. */
export default function LocationScreen() {
  const { isSignedIn } = useAuth();
  const { location, setLocation } = useDeliveryLocation();
  const addresses = useAddresses();
  const toast = useToast();
  const [locating, setLocating] = useState(false);

  const choose = (loc) => {
    setLocation(loc);
    goBack();
  };

  const useDevice = async () => {
    setLocating(true);
    try {
      const coords = await getDeviceCoordinates();
      choose({ ...coords, label: 'Current location', source: 'device' });
    } catch (e) {
      toast.show(e.message, 'danger');
    } finally {
      setLocating(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.cream }} contentContainerStyle={styles.content}>
      <Button title="Use my current location" icon="navigate" onPress={useDevice} loading={locating} fullWidth testID="use-device-location" />

      {isSignedIn ? (
        <View style={styles.group}>
          <Text variant="heading">Saved addresses</Text>
          {addresses.isPending ? (
            <Skeleton height={56} />
          ) : addresses.data?.items.length ? (
            addresses.data.items.map((a) => (
              <Option
                key={a.id}
                icon={a.label.toLowerCase().includes('work') ? 'briefcase-outline' : 'home-outline'}
                title={a.label}
                subtitle={`${a.line1}, ${a.area}`}
                selected={location?.source === 'address' && location.addressId === a.id}
                onPress={() => choose({ latitude: a.latitude, longitude: a.longitude, label: `${a.label} · ${a.line1}`, source: 'address', addressId: a.id })}
              />
            ))
          ) : (
            <Text tone="muted">No saved addresses yet.</Text>
          )}
          <Button title="Add a new address" variant="secondary" icon="add" onPress={() => router.push('/address-form')} />
        </View>
      ) : (
        <Text tone="muted">Sign in to use your saved addresses.</Text>
      )}

      <View style={styles.group}>
        <Text variant="heading">Or browse the pilot area</Text>
        <Option
          testID="use-pilot-area"
          icon="map-outline"
          title={PILOT_AREA.label}
          subtitle="Approximate. Use your exact address when you order."
          selected={location?.source === 'area'}
          onPress={() => choose(pilotAreaLocation())}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  group: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 12,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
