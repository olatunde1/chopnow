import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, touchTarget, typography } from '../../theme/tokens';
import { Text } from './Text';

/** Labelled input with inline validation message. Secure fields get a show/hide toggle. */
export const TextField = forwardRef(function TextField({ label, error, hint, secureTextEntry, style, testID, ...inputProps }, ref) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;
  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <Text variant="label" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View style={[styles.field, { borderColor }]}>
        <TextInput
          {...inputProps}
          ref={ref}
          testID={testID}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          secureTextEntry={secureTextEntry && !revealed}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((r) => !r)}
            hitSlop={8}
            style={styles.reveal}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" style={styles.message}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted" style={styles.message}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { color: colors.text },
  field: {
    minHeight: touchTarget,
    borderWidth: 1.5,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...typography.body, color: colors.text },
  reveal: { paddingHorizontal: spacing.md, minHeight: touchTarget, justifyContent: 'center' },
  message: { marginTop: 2 },
});
