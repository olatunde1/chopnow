import { Text as RNText } from 'react-native';
import { colors, typography } from '../../theme/tokens';

/**
 * Typography primitive. `variant` picks a size from the scale; `tone` picks a colour.
 * Long strings should pass numberOfLines so names never break layouts.
 */
export function Text({ variant = 'body', tone = 'default', style, ...props }) {
  const color =
    tone === 'muted' ? colors.textMuted : tone === 'inverse' ? colors.textInverse : tone === 'primary' ? colors.primary : tone === 'danger' ? colors.danger : colors.text;
  return <RNText {...props} style={[typography[variant], { color }, style]} />;
}
