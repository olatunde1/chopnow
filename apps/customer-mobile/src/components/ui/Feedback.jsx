import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing } from '../../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

/** Friendly empty state: an icon, a short title, guidance, and an optional action. */
export function EmptyState({ icon = 'fast-food-outline', title, message, actionLabel, onAction, testID }) {
  return (
    <View style={styles.center} testID={testID}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={32} color={colors.primary} />
      </View>
      <Text variant="heading" style={styles.centerText}>
        {title}
      </Text>
      {message ? (
        <Text tone="muted" style={styles.centerText}>
          {message}
        </Text>
      ) : null}
      {actionLabel ? <Button title={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}

/** Error state with retry. `message` should already be user-friendly (see ApiError.userMessage). */
export function ErrorState({ message = 'Something went wrong.', onRetry }) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <View style={[styles.iconCircle, { backgroundColor: colors.dangerSoft }]}>
        <Ionicons name="cloud-offline-outline" size={32} color={colors.danger} />
      </View>
      <Text variant="heading" style={styles.centerText}>
        We couldn’t load this
      </Text>
      <Text tone="muted" style={styles.centerText}>
        {message}
      </Text>
      {onRetry ? <Button title="Try again" icon="refresh" onPress={onRetry} variant="outline" /> : null}
    </View>
  );
}

/** Pulsing placeholder block for loading skeletons. */
export function Skeleton({ width = '100%', height = 16, radius: r = radius.sm, style }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View accessibilityElementsHidden style={[{ width, height, borderRadius: r, backgroundColor: colors.surfaceMuted, opacity }, style]} />;
}

/** Skeleton shaped like a restaurant or food card. */
export function CardSkeleton() {
  return (
    <View style={styles.cardSkeleton} accessibilityLabel="Loading">
      <Skeleton height={120} radius={radius.lg} />
      <Skeleton width="60%" height={18} />
      <Skeleton width="40%" height={14} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  centerText: { textAlign: 'center' },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSkeleton: { gap: spacing.sm, marginBottom: spacing.lg },
});
