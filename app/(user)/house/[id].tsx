import { router, useLocalSearchParams } from 'expo-router';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    useColorScheme,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { db } from '@/lib/firebase';

interface ReadingItem {
  id: string;
  period: string;
  value: number;
  consumption: number | null;
  photoUrl: string | null;
}

function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  const months = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
  ];
  const monthName = months[parseInt(m, 10) - 1] ?? m;
  return `${monthName} ${y}`;
}

export default function UserHouseReadingsScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const [readings, setReadings] = useState<ReadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;

  const loadReadings = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // Todas las lecturas de esta casa (con o sin userId); las reglas solo permiten leer si la casa es del usuario
      const q = query(
        collection(db, 'readings'),
        where('houseId', '==', id),
        orderBy('period', 'desc')
      );
      const snap = await getDocs(q);
      const list: ReadingItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          period: data.period ?? '',
          value: typeof data.value === 'number' ? data.value : 0,
          consumption: data.consumption ?? null,
          photoUrl: data.photoUrl ?? null,
        };
      });
      setReadings(list);
    } catch (err) {
      console.error(err);
      setError('No se pudo cargar el histórico.');
      setReadings([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReadings();
  }, [loadReadings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadReadings();
    setRefreshing(false);
  }, [loadReadings]);

  const renderItem = ({ item }: { item: ReadingItem }) => (
    <GesturePressable
      onPress={() => router.push(`/(user)/reading-detail?id=${item.id}` as const)}
    >
      <View style={[styles.row, { backgroundColor: colorScheme === 'dark' ? '#2a2a2a' : '#f5f5f5' }]}>
        <View style={styles.rowMain}>
          <ThemedText style={styles.period}>{formatPeriod(item.period)}</ThemedText>
          <ThemedText style={styles.value}>Lectura: {item.value}</ThemedText>
          {item.consumption != null && (
            <ThemedText style={styles.consumption}>Consumo: {item.consumption}</ThemedText>
          )}
        </View>
        <ThemedText style={[styles.photoBtnText, { color: tintColor }]}>Ver detalle</ThemedText>
      </View>
    </GesturePressable>
  );

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
        <ThemedText style={styles.loadingText}>Cargando histórico...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ThemedText type="title" style={styles.title}>
        Histórico de consumo
      </ThemedText>
      <ThemedText style={styles.subtitle}>
        Todas las lecturas almacenadas (con o sin foto).
      </ThemedText>
      {error ? (
        <ThemedText style={styles.errorText}>{error}</ThemedText>
      ) : null}

      <FlatList
        data={readings}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tintColor} />
        }
        ListEmptyComponent={
          <ThemedText style={styles.empty}>Aún no hay lecturas para esta casa.</ThemedText>
        }
      />

      <GesturePressable style={[styles.backLink, { marginBottom: insets.bottom }]} onPress={() => router.back()}>
        <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Volver a mis casas</ThemedText>
      </GesturePressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    opacity: 0.8,
  },
  title: {
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    marginBottom: 16,
    opacity: 0.8,
    textAlign: 'center',
    fontSize: 14,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  list: {
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  rowMain: {
    flex: 1,
  },
  period: {
    fontSize: 16,
    fontWeight: '600',
  },
  value: {
    fontSize: 14,
    opacity: 0.9,
    marginTop: 4,
  },
  consumption: {
    fontSize: 13,
    opacity: 0.8,
    marginTop: 2,
  },
  photoBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 24,
  },
  backLink: {
    alignSelf: 'center',
    height: 48,
    paddingHorizontal: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backLinkText: {
    fontSize: 16,
  },
});
