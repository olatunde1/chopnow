import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CartBar } from '../../components/CartBar';
import { LocationHeader } from '../../components/LocationHeader';
import { RestaurantCard } from '../../components/RestaurantCard';
import { CardSkeleton, Chip, EmptyState, ErrorState, Screen, SearchBar, Text } from '../../components/ui';
import { errorMessage, useCategories, useRestaurants } from '../../lib/hooks';
import { useAuth } from '../../state/auth';
import { useDeliveryLocation } from '../../state/location';
import { colors, radius, spacing } from '../../theme/tokens';

export default function HomeScreen() {
  const { user } = useAuth();
  const location = useDeliveryLocation((s) => s.location);
  const [includeClosed, setIncludeClosed] = useState(false);
  const restaurants = useRestaurants({ includeClosed: includeClosed ? 'true' : undefined, pageSize: 50 });
  const categories = useCategories();

  const header = (
    <View style={styles.header}>
      <LocationHeader />
      <Text variant="title">{user ? `Hungry, ${user.fullName.split(' ')[0]}?` : 'What are you craving?'}</Text>
      <SearchBar onPress={() => router.push('/search')} />

      {!location ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/location')} style={styles.locationPrompt}>
          <Ionicons name="navigate-circle" size={28} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Set your delivery location</Text>
            <Text variant="caption" tone="muted">
              We’ll show restaurants that can deliver to you, with delivery fees.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </Pressable>
      ) : null}

      {categories.data?.categories?.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">Browse by category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {categories.data.categories.map((c) => (
              <Chip key={c.name} label={c.name} onPress={() => router.push({ pathname: '/search', params: { category: c.name } })} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text variant="heading">{includeClosed ? 'All restaurants' : location ? 'Open now near you' : 'Open now'}</Text>
        <Chip label="Show closed" icon={includeClosed ? 'checkmark' : undefined} selected={includeClosed} onPress={() => setIncludeClosed((v) => !v)} />
      </View>
    </View>
  );

  let body = null;
  if (restaurants.isPending) {
    body = (
      <View>
        <CardSkeleton />
        <CardSkeleton />
      </View>
    );
  } else if (restaurants.isError) {
    body = <ErrorState message={errorMessage(restaurants.error)} onRetry={restaurants.refetch} />;
  }

  return (
    <Screen>
      <FlatList
        data={restaurants.data?.items ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <RestaurantCard restaurant={item} onPress={() => router.push(`/restaurant/${item.slug}`)} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          body ?? (
            <EmptyState
              icon="storefront-outline"
              title={location ? 'No restaurants open near you right now' : 'No restaurants open right now'}
              message="Restaurants in the pilot area open from 8am. You can still browse menus."
              actionLabel={includeClosed ? undefined : 'Show closed restaurants'}
              onAction={() => setIncludeClosed(true)}
            />
          )
        }
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={restaurants.isRefetching} onRefresh={restaurants.refetch} tintColor={colors.primary} />}
      />
      <CartBar />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: 120 },
  header: { gap: spacing.lg, marginBottom: spacing.md },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  locationPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
});
