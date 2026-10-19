import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { LoginRequestSchema } from '@chopnow/shared-schemas';
import { Button, Text, TextField, useToast } from '../components/ui';
import { apiFormErrors, zodFieldErrors } from '../lib/forms';
import { goBack } from '../lib/navigation';
import { useAuth } from '../state/auth';
import { colors, radius, spacing } from '../theme/tokens';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

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
      const user = await signIn(parsed.data);
      toast.show(`Welcome back, ${user.fullName.split(' ')[0]}`, 'success');
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
        <Text variant="title">Welcome back</Text>
        <Text tone="muted">Sign in to order, save addresses and track deliveries.</Text>
        {message ? (
          <View style={styles.alert} accessibilityRole="alert">
            <Text tone="danger">{message}</Text>
          </View>
        ) : null}
        <TextField
          label="Email"
          value={form.email}
          onChangeText={(email) => setForm((f) => ({ ...f, email }))}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          testID="email"
        />
        <TextField
          label="Password"
          value={form.password}
          onChangeText={(password) => setForm((f) => ({ ...f, password }))}
          error={errors.password}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
          testID="password"
        />
        <Button title="Sign in" onPress={submit} loading={busy} fullWidth testID="sign-in-submit" />
        <Button title="New to ChopNow? Create an account" variant="ghost" onPress={() => router.replace('/sign-up')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, width: '100%', maxWidth: 480, alignSelf: 'center' },
  alert: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
});
