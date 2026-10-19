import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing } from '../theme/tokens';
import { FoodImage, Price, StatusBadge, Text } from './ui';

export function MenuItemRow({ item, onPress, canOrder }) {
  const disabled = !item.isAvailable;
  return (
    <Pressable
      testID={`menu-item-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}${disabled ? ', sold out' : ''}`}
      aria-disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && !disabled && { opacity: 0.85 }]}
    >
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {item.name}
        </Text>
        {item.description ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.priceRow}>
          <Price kobo={item.fromPriceKobo} prefix={item.variants.length > 1 ? 'from' : undefined} />
          {disabled ? <StatusBadge label="Sold out" tone="danger" /> : null}
        </View>
      </View>
      <View>
        <FoodImage uri={item.imageUrl} name={item.name} size={84} rounded={radius.md} />
        {!disabled && canOrder ? (
          <View style={styles.add} accessibilityElementsHidden>
            <Ionicons name="add" size={20} color={colors.textInverse} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  disabled: { opacity: 0.6 },
  text: { flex: 1, gap: spacing.xs, minWidth: 0 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  add: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.cream,
  },
});
