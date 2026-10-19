import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { RegisterRequestSchema } from '@chopnow/shared-schemas';
import { Button, Text, TextField, useToast } from '../components/ui';
import { apiFormErrors, zodFieldErrors } from '../lib/forms';
import { goBack } from '../lib/navigation';
import { useAuth } from '../state/auth';
import { colors, radius, spacing } from '../theme/tokens';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setMessage(null);
    const input = { fullName: form.fullName, email: form.email, password: form.password, ...(form.phone.trim() ? { phone: form.phone } : {}) };
    // Same schema the API uses, so the user sees problems before sending anything.
    const parsed = RegisterRequestSchema.safeParse({ ...input, role: 'CUSTOMER' });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await signUp(input);
      toast.show('Account created. Welcome to ChopNow!', 'success');
      goBack();
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
        <Text variant="title">Create your account</Text>
        {message ? (
          <View style={styles.alert} accessibilityRole="alert">
            <Text tone="danger">{message}</Text>
          </View>
        ) : null}
        <TextField label="Full name" value={form.fullName} onChangeText={set('fullName')} error={errors.fullName} autoComplete="name" textContentType="name" testID="fullName" />
        <TextField
          label="Email"
          value={form.email}
          onChangeText={set('email')}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          testID="email"
        />
        <TextField
          label="Phone number (optional)"
          value={form.phone}
          onChangeText={set('phone')}
          error={errors.phone}
          keyboardType="phone-pad"
          autoComplete="tel"
          hint="So your rider can reach you, e.g. 0803 123 4567"
          testID="phone"
        />
        <TextField
          label="Password"
          value={form.password}
          onChangeText={set('password')}
          error={errors.password}
          secureTextEntry
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number"
          testID="password"
        />
        <Button title="Create account" onPress={submit} loading={busy} fullWidth testID="sign-up-submit" />
        <Button title="Already have an account? Sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, width: '100%', maxWidth: 480, alignSelf: 'center' },
  alert: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
});
