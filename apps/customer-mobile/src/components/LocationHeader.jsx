import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { describeLocation, useDeliveryLocation } from '../state/location';
import { colors, spacing, touchTarget } from '../theme/tokens';
import { Text } from './ui';

/** "Deliver to …" control at the top of Home; opens the location picker. */
export function LocationHeader() {
  const location = useDeliveryLocation((s) => s.location);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Delivery location: ${describeLocation(location)}. Change`}
      onPress={() => router.push('/location')}
      style={styles.row}
    >
      <View style={styles.icon}>
        <Ionicons name="location" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="muted">
          Deliver to
        </Text>
        <Text variant="bodyStrong" numberOfLines={1}>
          {describeLocation(location)}
        </Text>
      </View>
      <Ionicons name="chevron-down" size={18} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touchTarget },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
