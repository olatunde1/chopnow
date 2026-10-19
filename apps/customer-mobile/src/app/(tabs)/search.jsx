import { useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CartBar } from '../../components/CartBar';
import { FoodCard } from '../../components/FoodCard';
import { RestaurantCard } from '../../components/RestaurantCard';
import { CardSkeleton, Chip, EmptyState, ErrorState, Screen, SearchBar, Text } from '../../components/ui';
import { errorMessage, useDebouncedValue, useFoodSearch, useRestaurants } from '../../lib/hooks';
import { spacing } from '../../theme/tokens';

const FOOD_SORTS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'distance', label: 'Nearest' },
  { value: 'prep_time', label: 'Fastest' },
];

const PRICE_BANDS = [
  { key: 'any', label: 'Any price' },
  { key: 'u2', label: 'Under ₦2,000', max: 200_000 },
  { key: '2-4', label: '₦2,000–₦4,000', min: 200_000, max: 400_000 },
  { key: 'o4', label: 'Over ₦4,000', min: 400_000 },
];

export default function SearchScreen() {
  const params = useLocalSearchParams();
  const [mode, setMode] = useState('food');
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  const [category, setCategory] = useState(typeof params.category === 'string' ? params.category : undefined);
  const [sort, setSort] = useState('relevance');
  const [band, setBand] = useState('any');
  const [includeUnavailable, setIncludeUnavailable] = useState(false);

  // Category chips on Home navigate here with ?category=…
  useEffect(() => {
    if (typeof params.category === 'string') {
      setCategory(params.category);
      setQuery(params.category);
      setMode('food');
    }
  }, [params.category]);

  const q = useDebouncedValue(query.trim(), 300);
  const price = PRICE_BANDS.find((b) => b.key === band);
  const food = useFoodSearch(
    {
      q,
      sort,
      category: category && category.toLowerCase() === q.toLowerCase() ? category : undefined,
      minPriceKobo: price.min,
      maxPriceKobo: price.max,
      includeUnavailable: includeUnavailable ? 'true' : undefined,
      pageSize: 50,
    },
    mode === 'food' && q.length >= 2,
  );
  const restaurants = useRestaurants({ q: q || undefined, includeClosed: includeUnavailable ? 'true' : undefined, pageSize: 50 });
  const active = mode === 'food' ? food : restaurants;

  const header = (
    <View style={styles.header}>
      <SearchBar value={query} onChangeText={setQuery} autoFocus={!params.category} testID="search-input" />
      <View style={styles.row}>
        <Chip label="Food" selected={mode === 'food'} icon="fast-food-outline" onPress={() => setMode('food')} />
        <Chip label="Restaurants" selected={mode === 'restaurants'} icon="storefront-outline" onPress={() => setMode('restaurants')} />
        <Chip label="Include closed & sold out" selected={includeUnavailable} onPress={() => setIncludeUnavailable((v) => !v)} />
      </View>
      {mode === 'food' ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {FOOD_SORTS.map((s) => (
              <Chip key={s.value} label={s.label} selected={sort === s.value} onPress={() => setSort(s.value)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {PRICE_BANDS.map((b) => (
              <Chip key={b.key} label={b.label} selected={band === b.key} onPress={() => setBand(b.key)} />
            ))}
          </ScrollView>
        </>
      ) : null}
      {active.data ? (
        <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
          {active.data.total} {mode === 'food' ? 'dishes' : 'restaurants'}
        </Text>
      ) : null}
    </View>
  );

  let empty;
  if (mode === 'food' && q.length < 2) {
    empty = <EmptyState icon="search" title="Find your next meal" message="Search for a dish like jollof rice, amala or suya." />;
  } else if (active.isPending || (active.isFetching && !active.data)) {
    empty = (
      <View>
        <CardSkeleton />
        <CardSkeleton />
      </View>
    );
  } else if (active.isError) {
    empty = <ErrorState message={errorMessage(active.error)} onRetry={active.refetch} />;
  } else {
    empty = (
      <EmptyState
        icon="sad-outline"
        title={`No matches for “${q}”`}
        message={includeUnavailable ? 'Try a different spelling or another dish.' : 'Nothing open matches right now. Include closed restaurants to see more.'}
        actionLabel={includeUnavailable ? undefined : 'Include closed & sold out'}
        onAction={() => setIncludeUnavailable(true)}
      />
    );
  }

  return (
    <Screen>
      {mode === 'food' ? (
        <FlatList
          data={q.length >= 2 ? (food.data?.items ?? []) : []}
          keyExtractor={(r) => `${r.item.id}`}
          renderItem={({ item }) => (
            <FoodCard result={item} onPress={() => router.push({ pathname: '/restaurant/[slug]', params: { slug: item.restaurant.slug, item: item.item.id } })} />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList
          data={restaurants.data?.items ?? []}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => <RestaurantCard restaurant={item} onPress={() => router.push(`/restaurant/${item.slug}`)} />}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}
      <CartBar />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: 120 },
  header: { gap: spacing.md, marginBottom: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
