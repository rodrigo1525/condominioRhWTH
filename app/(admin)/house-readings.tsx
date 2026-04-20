import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
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
import { db } from '@/lib/firebase';

interface ReadingItem {
  id: string;
  period: string;
  value: number;
  previousValue: number | null;
  consumption: number | null;
  photoUrl: string | null;
}

function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const monthName = months[parseInt(m, 10) - 1] ?? m;
  return `${monthName} ${y}`;
}

export default function AdminHouseReadingsScreen() {
  const insets = useSafeAreaInsets();
  const { id: houseId } = useLocalSearchParams<{ id: string }>();
  const [houseAddress, setHouseAddress] = useState<string>('');
  const [readings, setReadings] = useState<ReadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;

  const load = useCallback(async () => {
    if (!houseId) return;
    setError(null);
    try {
      const [houseSnap, readingsSnap] = await Promise.all([
        getDoc(doc(db, 'houses', houseId)),
        getDocs(
          query(
            collection(db, 'readings'),
            where('houseId', '==', houseId),
            orderBy('period', 'desc')
          )
        ),
      ]);
      if (houseSnap.exists()) {
        setHouseAddress(houseSnap.data()?.address ?? '');
      }
      const list: ReadingItem[] = readingsSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          period: data.period ?? '',
          value: typeof data.value === 'number' ? data.value : 0,
          previousValue: data.previousValue ?? null,
          consumption: data.consumption ?? null,
          photoUrl: data.photoUrl ?? null,
        };
      });
      setReadings(list);
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar las lecturas.');
      setReadings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [houseId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const renderItem = ({ item }: { item: ReadingItem }) => (
    <View style={[styles.row, { backgroundColor: colorScheme === 'dark' ? '#2a2a2a' : '#f5f5f5' }]}>
      <View style={styles.rowMain}>
        <ThemedText style={styles.period}>{formatPeriod(item.period)}</ThemedText>
        <ThemedText style={styles.value}>Lectura: {item.value}</ThemedText>
        {item.previousValue != null && (
          <ThemedText style={styles.previous}>Anterior: {item.previousValue}</ThemedText>
        )}
        {item.consumption != null && (
          <ThemedText style={styles.consumption}>Consumo: {item.consumption}</ThemedText>
        )}
      </View>
      <View style={styles.actions}>
        <GesturePressable
          style={[styles.smallBtn, { borderColor: tintColor }]}
          onPress={() =>
            router.push(`/(admin)/reading-detail?id=${item.id}` as const)
          }
        >
          <ThemedText style={[styles.smallBtnText, { color: tintColor }]}>Ver</ThemedText>
        </GesturePressable>
        <GesturePressable
          style={[styles.smallBtn, { borderColor: tintColor }]}
          onPress={() =>
            router.push(`/(admin)/reading-edit?id=${item.id}` as const)
          }
        >
          <ThemedText style={[styles.smallBtnText, { color: tintColor }]}>Editar</ThemedText>
        </GesturePressable>
      </View>
    </View>
  );

  if (loading && readings.length === 0) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
        <ThemedText style={styles.loadingText}>Cargando lecturas...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Lecturas
      </ThemedText>
      <ThemedText style={styles.subtitle} numberOfLines={2}>
        {houseAddress || '(Casa)'}
      </ThemedText>
      <ThemedText style={styles.hint}>
        Todas las lecturas almacenadas (con o sin foto).
      </ThemedText>
      {error ? (
        <ThemedText style={styles.errorText}>{error}</ThemedText>
      ) : null}

      <FlatList
        data={readings}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tintColor} />
        }
        ListEmptyComponent={
          <ThemedText style={styles.empty}>No hay lecturas para esta casa.</ThemedText>
        }
      />

      <GesturePressable
        style={[styles.addButton, { backgroundColor: tintColor }]}
        onPress={() =>
          router.push(`/(admin)/reading-new?houseId=${houseId}` as const)
        }
      >
        <ThemedText style={[styles.addButtonText, { color: colorScheme === 'dark' ? '#111' : '#fff' }]}>
          Nueva lectura
        </ThemedText>
      </GesturePressable>
      <GesturePressable style={styles.backLink} onPress={() => router.back()}>
        <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Volver a casas</ThemedText>
      </GesturePressable>
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
    marginBottom: 4,
    opacity: 0.8,
    textAlign: 'center',
  },
  hint: {
    marginBottom: 16,
    opacity: 0.7,
    textAlign: 'center',
    fontSize: 13,
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
  previous: {
    fontSize: 13,
    opacity: 0.8,
    marginTop: 2,
  },
  consumption: {
    fontSize: 13,
    opacity: 0.8,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  smallBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 24,
  },
  addButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
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
