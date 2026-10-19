import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RestaurantCard } from '../../components/RestaurantCard';
import { CardSkeleton, EmptyState, ErrorState, Screen, Text } from '../../components/ui';
import { errorMessage, useFavourites } from '../../lib/hooks';
import { useAuth } from '../../state/auth';
import { colors, spacing } from '../../theme/tokens';

export default function FavouritesScreen() {
  const { isSignedIn, status } = useAuth();
  const favourites = useFavourites();

  if (status === 'restoring') return <Screen />;
  if (!isSignedIn) {
    return (
      <Screen>
        <EmptyState icon="heart-outline" title="Save your favourite spots" message="Sign in to keep a list of restaurants you love." actionLabel="Sign in" onAction={() => router.push('/sign-in')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={favourites.data?.items ?? []}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={
          <Text variant="title" style={styles.title}>
            Favourites
          </Text>
        }
        renderItem={({ item }) => <RestaurantCard restaurant={item} onPress={() => router.push(`/restaurant/${item.slug}`)} />}
        ListEmptyComponent={
          favourites.isPending ? (
            <CardSkeleton />
          ) : favourites.isError ? (
            <ErrorState message={errorMessage(favourites.error)} onRetry={favourites.refetch} />
          ) : (
            <EmptyState title="No favourites yet" message="Tap the heart on a restaurant to save it here." actionLabel="Browse restaurants" onAction={() => router.push('/')} />
          )
        }
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={favourites.isRefetching} onRefresh={favourites.refetch} tintColor={colors.primary} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg },
  title: { marginBottom: spacing.lg },
});
