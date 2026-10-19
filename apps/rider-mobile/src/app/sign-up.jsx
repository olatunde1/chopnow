import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { RegisterRequestSchema } from '@chopnow/shared-schemas';
import { Button, Chip, Text, TextField } from '../components/ui';
import { VEHICLE_LABEL } from '../lib/delivery';
import { apiFormErrors, toRegistration, zodFieldErrors } from '../lib/forms';
import { useAuth } from '../state/auth';
import { colors, radius, spacing } from '../theme/tokens';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', vehicleType: 'MOTORCYCLE', vehiclePlate: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setMessage(null);
    const parsed = RegisterRequestSchema.safeParse(toRegistration(form));
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      // The API creates the rider as PENDING and OFFLINE; operations approves before any work.
      await signUp(toRegistration(form));
      router.replace('/account');
    } catch (err) {
      const { fields, message: m } = apiFormErrors(err);
      setErrors(fields);
      setMessage(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text tone="muted">Apply to deliver with ChopNow. We check every rider before they can go online; upload your documents after signing up to speed it up.</Text>
        {message ? (
          <View style={styles.alert} accessibilityRole="alert">
            <Text tone="danger">{message}</Text>
          </View>
        ) : null}
        <TextField label="Full name" value={form.fullName} onChangeText={set('fullName')} error={errors.fullName} autoComplete="name" testID="full-name" />
        <TextField label="Phone" value={form.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" placeholder="0803 000 0000" autoComplete="tel" testID="phone" />
        <TextField label="Email" value={form.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" testID="email" />
        <TextField label="Password" value={form.password} onChangeText={set('password')} error={errors.password} secureTextEntry autoComplete="new-password" hint="At least 8 characters, with a letter and a number" testID="password" />
        <Text variant="label">Vehicle</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {Object.entries(VEHICLE_LABEL).map(([value, label]) => (
            <Chip key={value} label={label} selected={form.vehicleType === value} onPress={() => set('vehicleType')(value)} />
          ))}
        </View>
        {form.vehicleType === 'MOTORCYCLE' || form.vehicleType === 'CAR' ? (
          <TextField label="Plate number (optional)" value={form.vehiclePlate} onChangeText={set('vehiclePlate')} autoCapitalize="characters" maxLength={20} testID="plate" />
        ) : null}
        <Button title="Apply" onPress={submit} loading={busy} fullWidth testID="sign-up-submit" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, width: '100%', maxWidth: 480, alignSelf: 'center' },
  alert: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
