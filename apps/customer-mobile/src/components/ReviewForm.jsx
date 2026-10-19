import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Text, TextField } from './ui';
import { colors, radius, spacing, touchTarget } from '../theme/tokens';

const WORDS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

/** Star rating + optional comment for a delivered order. `onSubmit` receives the API payload. */
export function ReviewForm({ restaurantName, riderName, onSubmit }) {
  const [rating, setRating] = useState(0);
  const [riderRating, setRiderRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ restaurantRating: rating, ...(riderName && riderRating ? { riderRating } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
    } catch (e) {
      setError(e?.message ?? 'Could not send your review.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text variant="heading">How was {restaurantName}?</Text>
      <Stars value={rating} onChange={setRating} label="Restaurant rating" testPrefix="star" />
      {rating ? <Text tone="muted">{WORDS[rating]}</Text> : null}
      {riderName ? (
        <>
          <Text variant="bodyStrong">And {riderName}, your rider? (optional)</Text>
          <Stars value={riderRating} onChange={setRiderRating} label="Rider rating" testPrefix="rider-star" size={26} />
        </>
      ) : null}
      <TextField label="Comment (optional)" value={comment} onChangeText={setComment} multiline maxLength={1000} placeholder="What did you enjoy? What could be better?" testID="review-comment" />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="Send review" onPress={submit} disabled={!rating} loading={busy} fullWidth testID="send-review" />
    </View>
  );
}

function Stars({ value, onChange, label, testPrefix, size = 32 }) {
  return (
    <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n)}
          accessibilityRole="radio"
          aria-checked={value === n}
          accessibilityLabel={`${label}: ${n} star${n > 1 ? 's' : ''}`}
          testID={`${testPrefix}-${n}`}
          style={styles.star}
        >
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? colors.warning : colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  stars: { flexDirection: 'row', gap: spacing.xs },
  star: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
