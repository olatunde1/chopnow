import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMinor } from '@chopnow/shared-utils';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { Text } from './Text';

const TONES = {
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
  neutral: { bg: colors.surfaceMuted, fg: colors.textMuted },
  brand: { bg: colors.primarySoft, fg: colors.primaryDark },
};

/** Status pill. Always pairs colour with text so meaning never relies on colour alone. */
export function StatusBadge({ label, tone = 'neutral', icon }) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]} accessibilityLabel={label}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[typography.label, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Money display. Amounts are integer kobo. */
export function Price({ kobo, prefix, variant = 'bodyStrong', tone = 'default', style }) {
  if (kobo === null || kobo === undefined) return null;
  return (
    <Text variant={variant} tone={tone} style={style} numberOfLines={1}>
      {prefix ? `${prefix} ` : ''}
      {formatMinor(kobo)}
    </Text>
  );
}

/** Selectable chip for filters and categories. */
export function Chip({ label, selected, onPress, icon }) {
  return (
    <Pressable
      accessibilityRole="button"
      // Native screen readers read "selected"; on the web a toggle button is aria-pressed.
      accessibilityState={{ selected: !!selected }}
      aria-pressed={!!selected}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      hitSlop={4}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? colors.textInverse : colors.text} /> : null}
      <Text style={[typography.label, { color: selected ? colors.textInverse : colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.text, borderColor: colors.text },
});
