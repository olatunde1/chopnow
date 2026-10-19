import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, CardSkeleton, Chip, ConfirmDialog, ErrorState, Screen, StatusBadge, Text, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { APPROVAL_LABEL, DOCUMENT_TYPES, VEHICLE_LABEL } from '../../lib/delivery';
import { errorMessage, useProfile } from '../../lib/hooks';
import { useAuth } from '../../state/auth';
import { colors, radius, spacing } from '../../theme/tokens';

const DOC_STATUS = { PENDING: ['Under review', 'warning'], ACCEPTED: ['Accepted', 'success'], REJECTED: ['Not accepted', 'danger'] };
const DOC_LABEL = Object.fromEntries(DOCUMENT_TYPES);

export default function AccountScreen() {
  const { user, signOut } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const docs = useQuery({ queryKey: ['rider', 'documents'], queryFn: api.rider.documents });
  const [type, setType] = useState('DRIVERS_LICENCE');
  const [uploading, setUploading] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const upload = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const file = picked.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) {
      toast.show('That file is over 10 MB. Choose a smaller one.', 'danger');
      return;
    }
    setUploading(true);
    try {
      await api.rider.uploadDocument(type, file);
      toast.show(`${DOC_LABEL[type]} uploaded`, 'success');
      queryClient.invalidateQueries({ queryKey: ['rider', 'documents'] });
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setUploading(false);
    }
  };

  if (profile.isPending) {
    return (
      <Screen>
        <View style={styles.content}>
          <CardSkeleton />
        </View>
      </Screen>
    );
  }
  if (profile.isError) return <ErrorState message={errorMessage(profile.error)} onRetry={profile.refetch} />;
  const me = profile.data;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="title">{me.fullName}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text tone="muted" style={{ flex: 1 }}>
              Status
            </Text>
            <StatusBadge label={APPROVAL_LABEL[me.verificationStatus]} tone={me.verificationStatus === 'APPROVED' ? 'success' : 'warning'} />
          </View>
          <View style={styles.row}>
            <Text tone="muted" style={{ flex: 1 }}>
              Rider type
            </Text>
            <Text>{me.riderType === 'CORE' ? 'Core rider' : 'Independent rider'}</Text>
          </View>
          <View style={styles.row}>
            <Text tone="muted" style={{ flex: 1 }}>
              Vehicle
            </Text>
            <Text>
              {VEHICLE_LABEL[me.vehicleType]}
              {me.vehiclePlate ? ` · ${me.vehiclePlate}` : ''}
            </Text>
          </View>
          <View style={styles.row}>
            <Text tone="muted" style={{ flex: 1 }}>
              Deliveries · rating
            </Text>
            <Text>
              {me.completedDeliveries} · {me.ratingAverage ? `${me.ratingAverage.toFixed(1)} ★ (${me.ratingCount})` : 'no ratings yet'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text tone="muted" style={{ flex: 1 }}>
              Email
            </Text>
            <Text>{user?.email}</Text>
          </View>
        </View>

        <Text variant="heading">Documents</Text>
        <Text tone="muted">PDF, JPG or PNG up to 10 MB. Only ChopNow’s review team can see them.</Text>
        <View style={styles.chips}>
          {DOCUMENT_TYPES.map(([value, label]) => (
            <Chip key={value} label={label} selected={type === value} onPress={() => setType(value)} />
          ))}
        </View>
        <Button title={`Upload ${DOC_LABEL[type].toLowerCase()}`} icon="cloud-upload-outline" variant="secondary" onPress={upload} loading={uploading} fullWidth testID="upload-document" />
        {docs.isPending ? (
          <CardSkeleton />
        ) : docs.isError ? (
          <ErrorState message={errorMessage(docs.error)} onRetry={docs.refetch} />
        ) : docs.data.items.length === 0 ? (
          <Text tone="muted">No documents uploaded yet.</Text>
        ) : (
          <View style={styles.card}>
            {docs.data.items.map((d) => {
              const [label, tone] = DOC_STATUS[d.status] ?? [d.status, 'neutral'];
              return (
                <View key={d.id} style={styles.row}>
                  <Ionicons name="document-text-outline" size={20} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{DOC_LABEL[d.type] ?? d.type}</Text>
                    <Text tone="muted" numberOfLines={1}>
                      {d.originalName}
                    </Text>
                    {d.reviewNote ? <Text tone="danger">{d.reviewNote}</Text> : null}
                  </View>
                  <StatusBadge label={label} tone={tone} />
                </View>
              );
            })}
          </View>
        )}

        <Button title="Sign out" variant="outline" icon="log-out-outline" onPress={() => setConfirmSignOut(true)} fullWidth />
      </ScrollView>
      <ConfirmDialog
        visible={confirmSignOut}
        title="Sign out?"
        message="You’ll go offline and stop receiving offers."
        confirmLabel="Sign out"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          setConfirmSignOut(false);
          await signOut();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: spacing.xxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
