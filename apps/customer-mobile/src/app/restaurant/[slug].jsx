import { useEffect, useMemo, useState, useRef } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { localDayAndMinute, minutesToHHMM } from '@chopnow/shared-utils';
import { CartBar } from '../../components/CartBar';
import { ItemCustomiser } from '../../components/ItemCustomiser';
import { MenuItemRow } from '../../components/MenuItemRow';
import { RestaurantMeta, availabilityBadge } from '../../components/RestaurantCard';
import { CardSkeleton, ConfirmDialog, EmptyState, ErrorState, FoodImage, Price, StatusBadge, Text, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useRestaurant } from '../../lib/hooks';
import { useAuth } from '../../state/auth';
import { useCart } from '../../state/cart';
import { colors, radius, spacing, touchTarget } from '../../theme/tokens';

function todaysHours(hours) {
  const { dayOfWeek } = localDayAndMinute(new Date());
  const today = hours.filter((h) => h.dayOfWeek === dayOfWeek);
  if (!today.length) return 'Closed today';
  return today.map((h) => `${minutesToHHMM(h.opensAt)}–${minutesToHHMM(h.closesAt)}`).join(', ');
}

function unavailableReason(r) {
  if (r.isAcceptingOrders) return null;
  if (r.deliversToLocation === false) return 'This restaurant doesn’t deliver to your location.';
  if (!r.isOpenNow) return 'This restaurant is closed right now. You can browse the menu.';
  return 'This restaurant isn’t taking orders right now.';
}

export default function RestaurantScreen() {
  const { slug, item: itemParam } = useLocalSearchParams();
  const { data: r, isPending, isError, error, refetch } = useRestaurant(slug);
  const { isSignedIn } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const addLine = useCart((s) => s.addLine);
  const replaceWith = useCart((s) => s.replaceWith);
  const cartRestaurant = useCart((s) => s.restaurant);
  const [openItem, setOpenItem] = useState(null);
  const [pendingLine, setPendingLine] = useState(null);

  const sections = useMemo(() => (r ? r.menu.categories.map((c) => ({ title: c.name, data: c.items })) : []), [r]);
  const allItems = useMemo(() => sections.flatMap((s) => s.data), [sections]);

  // Opened from a food search result: show that dish straight away, once. (Re-running this after
  // the sheet closes would reopen it forever, trapping the customer on the dish.)
  const autoOpened = useRef(null);
  useEffect(() => {
    if (itemParam && allItems.length && autoOpened.current !== itemParam) {
      autoOpened.current = itemParam;
      const found = allItems.find((i) => i.id === itemParam);
      if (found?.isAvailable) setOpenItem(found);
    }
  }, [itemParam, allItems]);

  const favourite = useMutation({
    mutationFn: () => (r.isFavourite ? api.favourites.remove(r.id) : api.favourites.add(r.id)),
    onSuccess: () => {
      toast.show(r.isFavourite ? 'Removed from favourites' : 'Saved to favourites', 'success');
      queryClient.invalidateQueries({ queryKey: ['restaurant', slug] });
      queryClient.invalidateQueries({ queryKey: ['me', 'favourites'] });
      queryClient.invalidateQueries({ queryKey: ['restaurants'] });
    },
    onError: (e) => toast.show(errorMessage(e), 'danger'),
  });

  if (isPending) {
    return (
      <View style={styles.pad}>
        <Stack.Screen options={{ title: '' }} />
        <CardSkeleton />
        <CardSkeleton />
      </View>
    );
  }
  if (isError) {
    return error?.status === 404 ? (
      <EmptyState icon="storefront-outline" title="Restaurant not found" message="It may no longer be available on ChopNow." actionLabel="Back to home" onAction={() => router.replace('/')} />
    ) : (
      <ErrorState message={errorMessage(error)} onRetry={refetch} />
    );
  }

  const reason = unavailableReason(r);
  const restaurantRef = { id: r.id, slug: r.slug, name: r.name, minOrderKobo: r.minOrderKobo };

  const handleAdd = (line) => {
    const result = addLine(restaurantRef, line);
    if (result === 'DIFFERENT_RESTAURANT') {
      setPendingLine(line);
      return;
    }
    setOpenItem(null);
    toast.show(`Added ${line.quantity} × ${line.name}`, 'success');
  };

  const header = (
    <View style={styles.header}>
      <FoodImage uri={r.coverImageUrl} name={r.name} height={160} />
      <View style={styles.titleRow}>
        <Text variant="title" style={{ flex: 1 }} numberOfLines={2}>
          {r.name}
        </Text>
        {isSignedIn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={r.isFavourite ? 'Remove from favourites' : 'Save to favourites'}
            onPress={() => favourite.mutate()}
            disabled={favourite.isPending}
            style={styles.fav}
          >
            <Ionicons name={r.isFavourite ? 'heart' : 'heart-outline'} size={24} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      <StatusBadge {...availabilityBadge(r)} />
      {r.description ? <Text tone="muted">{r.description}</Text> : null}
      <RestaurantMeta restaurant={r} />
      <View style={styles.infoRow}>
        <Ionicons name="time-outline" size={16} color={colors.textMuted} />
        <Text variant="caption" tone="muted">
          Today: {todaysHours(r.hours)}
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Ionicons name="location-outline" size={16} color={colors.textMuted} />
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {r.addressLine}, {r.area}
        </Text>
      </View>
      {r.minOrderKobo > 0 ? (
        <View style={styles.infoRow}>
          <Ionicons name="receipt-outline" size={16} color={colors.textMuted} />
          <Text variant="caption" tone="muted">
            Minimum order <Price kobo={r.minOrderKobo} variant="caption" tone="muted" />
          </Text>
        </View>
      ) : null}
      {reason ? (
        <View style={styles.banner} accessibilityRole="alert">
          <Ionicons name="information-circle" size={20} color={colors.warning} />
          <Text variant="caption" style={{ flex: 1 }}>
            {reason}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Stack.Screen options={{ title: r.name }} />
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.id}
        renderSectionHeader={({ section }) => (
          <Text variant="heading" style={styles.sectionTitle} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <MenuItemRow item={item} canOrder={!reason} onPress={() => setOpenItem(item)} />}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState icon="book-outline" title="No menu yet" message="This restaurant hasn’t added any dishes." />}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
      />
      <ItemCustomiser
        key={openItem?.id ?? 'none'}
        item={openItem}
        visible={!!openItem}
        onClose={() => setOpenItem(null)}
        onAdd={handleAdd}
        canOrder={!reason}
        unavailableReason={reason}
      />
      <ConfirmDialog
        visible={!!pendingLine}
        title="Start a new cart?"
        message={`Your cart has food from ${cartRestaurant?.name}. You can only order from one restaurant at a time. Clear it and add this item from ${r.name}?`}
        confirmLabel="Start new cart"
        destructive
        onCancel={() => setPendingLine(null)}
        onConfirm={() => {
          replaceWith(restaurantRef, pendingLine);
          toast.show(`Added ${pendingLine.quantity} × ${pendingLine.name}`, 'success');
          setPendingLine(null);
          setOpenItem(null);
        }}
      />
      <CartBar />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg },
  list: { padding: spacing.lg, paddingBottom: 120, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { gap: spacing.sm, marginBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  fav: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.xs },
});
