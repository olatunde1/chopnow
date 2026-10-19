import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, ConfirmDialog, EmptyState, Screen, Text, useToast } from '../../components/ui';
import { useAuth } from '../../state/auth';
import { colors, radius, spacing, touchTarget } from '../../theme/tokens';

function Row({ icon, label, onPress, detail }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </Text>
      {detail ? (
        <Text variant="caption" tone="muted">
          {detail}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function AccountScreen() {
  const { user, isSignedIn, status, signOut } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status === 'restoring') return <Screen />;
  if (!isSignedIn) {
    return (
      <Screen>
        <EmptyState icon="person-circle-outline" title="Welcome to ChopNow" message="Sign in to save addresses and favourites, and to place orders." actionLabel="Sign in" onAction={() => router.push('/sign-in')} />
        <View style={styles.center}>
          <Button title="Create an account" variant="ghost" onPress={() => router.push('/sign-up')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text variant="title" tone="inverse">
              {user.fullName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="heading" numberOfLines={1}>
              {user.fullName}
            </Text>
            <Text tone="muted" numberOfLines={1}>
              {user.email}
            </Text>
            {user.phone ? (
              <Text variant="caption" tone="muted">
                {user.phone}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.group}>
          <Row icon="notifications-outline" label="Notifications" onPress={() => router.push('/notifications')} />
          <Row icon="location-outline" label="Saved addresses" onPress={() => router.push('/addresses')} />
          <Row icon="navigate-outline" label="Delivery location" onPress={() => router.push('/location')} />
          <Row icon="heart-outline" label="Favourites" onPress={() => router.push('/favourites')} />
        </View>
        <Button
          title="Sign out"
          variant="outline"
          icon="log-out-outline"
          loading={busy}
          onPress={() => setConfirm(true)}
        />
      </ScrollView>
      <ConfirmDialog
        visible={confirm}
        title="Sign out?"
        message="You’ll need to sign in again to see your addresses and favourites."
        confirmLabel="Sign out"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          setBusy(true);
          await signOut();
          setBusy(false);
          toast.show('Signed out');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl },
  center: { alignItems: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
