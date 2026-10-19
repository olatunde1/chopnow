import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, touchTarget, typography } from '../../theme/tokens';

/**
 * Search input. When `onPress` is given it renders as a button (used on Home to open the Search tab).
 */
export function SearchBar({ value, onChangeText, placeholder = 'Search for jollof, suya, amala…', onPress, onSubmit, autoFocus, testID }) {
  const content = (
    <View style={styles.bar} pointerEvents={onPress ? 'none' : 'auto'}>
      <Ionicons name="search" size={20} color={colors.textMuted} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search food or restaurants"
        editable={!onPress}
      />
      {value && !onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText?.('')} hitSlop={10}>
          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="search" accessibilityLabel="Search food or restaurants" onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, ...typography.body, color: colors.text, paddingVertical: spacing.sm },
});
