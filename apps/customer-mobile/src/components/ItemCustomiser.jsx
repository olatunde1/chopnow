import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMinor } from '@chopnow/shared-utils';
import { initialVariantId, priceSelection } from '../lib/menu-pricing';
import { MAX_LINE_QUANTITY } from '../state/cart';
import { colors, radius, spacing, touchTarget, typography } from '../theme/tokens';
import { Button, FoodImage, Price, QuantityStepper, Sheet, StatusBadge, Text } from './ui';

/**
 * Bottom sheet to choose a variant, extras, quantity and instructions for one menu item.
 * The total updates live; the add button is disabled while the selection is invalid.
 */
export function ItemCustomiser({ item, visible, onClose, onAdd, canOrder, unavailableReason }) {
  const [variantId, setVariantId] = useState(() => (item ? initialVariantId(item) : null));
  const [extras, setExtras] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState('');

  const priced = useMemo(() => (item ? priceSelection(item, { variantId, extras, quantity }, { maxQuantity: MAX_LINE_QUANTITY }) : null), [item, variantId, extras, quantity]);
  if (!item) return null;

  const setExtra = (id, q) => setExtras((prev) => ({ ...prev, [id]: q }));
  const add = () => {
    onAdd({
      menuItemId: item.id,
      name: item.name,
      variantId: priced.variant?.id ?? null,
      variantName: priced.variant?.name ?? null,
      extras: priced.extras,
      quantity,
      unitPriceKobo: priced.unitPriceKobo,
      instructions: instructions.trim() || undefined,
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item.name}
      footer={
        <View style={styles.footer}>
          {!canOrder ? (
            <Text variant="caption" tone="danger" style={styles.footerNote}>
              {unavailableReason}
            </Text>
          ) : priced.problems.length ? (
            <Text variant="caption" tone="danger" style={styles.footerNote} accessibilityLiveRegion="polite">
              {priced.problems[0]}
            </Text>
          ) : null}
          <View style={styles.footerRow}>
            <QuantityStepper value={quantity} onChange={setQuantity} max={MAX_LINE_QUANTITY} testID="qty" />
            <Button
              testID="add-to-cart"
              title={`Add · ${formatMinor(priced.lineTotalKobo)}`}
              onPress={add}
              disabled={!canOrder || !priced.ok}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FoodImage uri={item.imageUrl} name={item.name} height={160} />
        {item.description ? <Text tone="muted">{item.description}</Text> : null}

        {item.variants.length > 0 ? (
          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <Text variant="heading">Choose an option</Text>
              <StatusBadge label="Required" tone="brand" />
            </View>
            {item.variants.map((v) => {
              const selected = v.id === variantId;
              return (
                <Pressable
                  key={v.id}
                  testID={`variant-${v.name}`}
                  accessibilityRole="radio"
                  aria-checked={selected} aria-disabled={!v.isAvailable}
                  disabled={!v.isAvailable}
                  onPress={() => setVariantId(v.id)}
                  style={[styles.option, selected && styles.optionSelected, !v.isAvailable && styles.optionDisabled]}
                >
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textMuted} />
                  <Text style={styles.optionLabel} numberOfLines={1}>
                    {v.name}
                  </Text>
                  {v.isAvailable ? <Price kobo={v.priceKobo} variant="body" /> : <StatusBadge label="Sold out" tone="danger" />}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {item.extras.length > 0 ? (
          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <Text variant="heading">Add extras</Text>
              <StatusBadge label="Optional" tone="neutral" />
            </View>
            {item.extras.map((e) => {
              const q = extras[e.id] ?? 0;
              return (
                <View key={e.id} style={[styles.option, !e.isAvailable && styles.optionDisabled]}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1}>{e.name}</Text>
                    <Text variant="caption" tone="muted">
                      +{formatMinor(e.priceKobo)}
                      {e.maxQuantity > 1 ? ` · up to ${e.maxQuantity}` : ''}
                    </Text>
                  </View>
                  {!e.isAvailable ? (
                    <StatusBadge label="Sold out" tone="danger" />
                  ) : e.maxQuantity === 1 ? (
                    <Pressable
                      testID={`extra-${e.name}`}
                      accessibilityRole="checkbox"
                      accessibilityLabel={e.name}
                      aria-checked={q === 1}
                      onPress={() => setExtra(e.id, q === 1 ? 0 : 1)}
                      style={styles.check}
                      hitSlop={8}
                    >
                      <Ionicons name={q === 1 ? 'checkbox' : 'square-outline'} size={24} color={q === 1 ? colors.primary : colors.textMuted} />
                    </Pressable>
                  ) : (
                    <QuantityStepper value={q} onChange={(n) => setExtra(e.id, n)} min={0} max={e.maxQuantity} testID={`extra-${e.name}`} name={e.name} />
                  )}
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.group}>
          <Text variant="heading">Special instructions</Text>
          <TextInput
            value={instructions}
            onChangeText={setInstructions}
            placeholder="e.g. less pepper, no onions"
            placeholderTextColor={colors.textMuted}
            maxLength={200}
            multiline
            style={styles.notes}
            accessibilityLabel="Special instructions"
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionDisabled: { opacity: 0.55 },
  optionLabel: { flex: 1 },
  check: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  notes: {
    minHeight: 72,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    textAlignVertical: 'top',
    ...typography.body,
    color: colors.text,
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  footerNote: { textAlign: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
