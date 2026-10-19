import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, touchTarget } from '../../theme/tokens';
import { Text } from './Text';

/** Screen wrapper: cream background, safe-area aware, centred max width on tablets and web. */
export function Screen({ children, edges = ['top'], style }) {
  return (
    <SafeAreaView edges={edges} style={styles.screen}>
      <View style={[styles.inner, style]}>{children}</View>
    </SafeAreaView>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** − n + control with 48pt targets. */
export function QuantityStepper({ value, onChange, min = 1, max = 20, testID }) {
  const btn = (icon, next, disabled, label) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={[styles.stepBtn, disabled && { opacity: 0.4 }]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
  return (
    <View style={styles.stepper} testID={testID}>
      {btn('remove', value - 1, value <= min, 'Decrease quantity')}
      <Text variant="bodyStrong" style={styles.stepValue} accessibilityLabel={`Quantity ${value}`}>
        {value}
      </Text>
      {btn('add', value + 1, value >= max, 'Increase quantity')}
    </View>
  );
}

/**
 * Food or restaurant image. Until vendors upload photos (Phase 6), a warm placeholder tile with the
 * dish initial is shown instead of a broken image.
 */
export function FoodImage({ uri, name = '', size, height = 120, style, rounded = radius.lg }) {
  const dims = size ? { width: size, height: size } : { width: '100%', height };
  if (uri) {
    return <Image source={{ uri }} style={[dims, { borderRadius: rounded, backgroundColor: colors.surfaceMuted }, style]} accessibilityIgnoresInvertColors />;
  }
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[dims, styles.placeholder, { borderRadius: rounded }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name="restaurant" size={size ? Math.max(18, size / 3) : 28} color={colors.primary} style={styles.placeholderIcon} />
      <Text variant={size && size < 72 ? 'heading' : 'display'} style={styles.placeholderInitial}>
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  inner: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  stepBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 28, textAlign: 'center' },
  placeholder: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  placeholderIcon: { position: 'absolute', top: spacing.sm, right: spacing.sm, opacity: 0.5 },
  placeholderInitial: { color: colors.primaryDark },
});
