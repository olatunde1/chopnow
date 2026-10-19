import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { LoginRequestSchema } from '@chopnow/shared-schemas';
import { Button, Text, TextField } from '../components/ui';
import { apiFormErrors, zodFieldErrors } from '../lib/forms';
import { useAuth } from '../state/auth';
import { colors, radius, spacing } from '../theme/tokens';

export default function SignInScreen() {
  const { signIn, status, error } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signedIn') return <Redirect href="/" />;

  const submit = async () => {
    setMessage(null);
    const parsed = LoginRequestSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await signIn(parsed.data);
      router.replace('/');
    } catch (err) {
      const { fields, message: m } = apiFormErrors(err);
      setErrors(fields);
      setMessage(m === 'Something went wrong. Please try again.' && err?.message ? err.message : m);
    } finally {
      setBusy(false);
    }
  };

  const shown = message ?? error;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="display">ChopNow Rider</Text>
        <Text tone="muted">Sign in to go online and receive deliveries.</Text>
        {shown ? (
          <View style={styles.alert} accessibilityRole="alert">
            <Text tone="danger">{shown}</Text>
          </View>
        ) : null}
        <TextField label="Email" value={form.email} onChangeText={(email) => setForm((f) => ({ ...f, email }))} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" testID="email" />
        <TextField label="Password" value={form.password} onChangeText={(password) => setForm((f) => ({ ...f, password }))} error={errors.password} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} testID="password" />
        <Button title="Sign in" onPress={submit} loading={busy} fullWidth testID="sign-in-submit" />
        <Button title="New rider? Apply here" variant="ghost" onPress={() => router.push('/sign-up')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, width: '100%', maxWidth: 480, alignSelf: 'center' },
  alert: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
});
