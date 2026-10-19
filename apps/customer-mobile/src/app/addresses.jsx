import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, CardSkeleton, ConfirmDialog, EmptyState, ErrorState, Screen, StatusBadge, Text, useToast } from '../components/ui';
import { api } from '../lib/api';
import { errorMessage, useAddresses } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useDeliveryLocation } from '../state/location';
import { colors, radius, spacing, touchTarget } from '../theme/tokens';

export default function AddressesScreen() {
  const { isSignedIn } = useAuth();
  const addresses = useAddresses();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { location, clearLocation } = useDeliveryLocation();
  const [toDelete, setToDelete] = useState(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'addresses'] });
  const makeDefault = useMutation({
    mutationFn: (id) => api.addresses.makeDefault(id),
    onSuccess: () => {
      refresh();
      toast.show('Default address updated', 'success');
    },
    onError: (e) => toast.show(errorMessage(e), 'danger'),
  });
  const remove = useMutation({
    mutationFn: (id) => api.addresses.remove(id),
    onSuccess: (_d, id) => {
      if (location?.addressId === id) clearLocation();
      refresh();
      toast.show('Address removed');
    },
    onError: (e) => toast.show(errorMessage(e), 'danger'),
  });

  if (!isSignedIn) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="location-outline" title="Sign in to save addresses" actionLabel="Sign in" onAction={() => router.push('/sign-in')} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <FlatList
        data={addresses.data?.items ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        renderItem={({ item: a }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {a.label}
              </Text>
              {a.isDefault ? <StatusBadge label="Default" tone="brand" /> : null}
            </View>
            <Text tone="muted" numberOfLines={2}>
              {[a.line1, a.line2, a.area, a.city].filter(Boolean).join(', ')}
            </Text>
            {a.landmark ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                Landmark: {a.landmark}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/address-form', params: { id: a.id } })} style={styles.action}>
                <Ionicons name="create-outline" size={18} color={colors.primary} />
                <Text variant="label" tone="primary">
                  Edit
                </Text>
              </Pressable>
              {!a.isDefault ? (
                <Pressable accessibilityRole="button" onPress={() => makeDefault.mutate(a.id)} style={styles.action}>
                  <Ionicons name="star-outline" size={18} color={colors.primary} />
                  <Text variant="label" tone="primary">
                    Make default
                  </Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" onPress={() => setToDelete(a)} style={styles.action}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text variant="label" tone="danger">
                  Remove
                </Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          addresses.isPending ? (
            <CardSkeleton />
          ) : addresses.isError ? (
            <ErrorState message={errorMessage(addresses.error)} onRetry={addresses.refetch} />
          ) : (
            <EmptyState icon="home-outline" title="No saved addresses" message="Add your home or work address for faster checkout." />
          )
        }
        ListFooterComponent={<Button title="Add a new address" icon="add" onPress={() => router.push('/address-form')} fullWidth />}
      />
      <ConfirmDialog
        visible={!!toDelete}
        title="Remove this address?"
        message={toDelete ? `${toDelete.label}: ${toDelete.line1}` : ''}
        confirmLabel="Remove"
        destructive
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          remove.mutate(toDelete.id);
          setToDelete(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs, marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: touchTarget - 8 },
});
