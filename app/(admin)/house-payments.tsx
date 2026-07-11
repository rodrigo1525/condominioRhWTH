import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { db } from '@/lib/firebase';
import { formatMoneyInput, parseMoneyField } from '@/lib/money-utils';

interface PagoItem {
  id: string;
  fechaPago: string;
  mora: number;
  consumo: number;
  cuotaMantenimiento: number;
  total: number;
  pago: number;
  diferencia: number;
}

function formatMoney(value: number): string {
  return formatMoneyInput(value);
}

export default function HousePaymentsScreen() {
  const { id: houseId } = useLocalSearchParams<{ id: string }>();
  const [houseAddress, setHouseAddress] = useState('');
  const [pagos, setPagos] = useState<PagoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;

  const load = useCallback(async () => {
    if (!houseId) return;
    setError(null);
    try {
      const [houseSnap, pagosSnap] = await Promise.all([
        getDoc(doc(db, 'houses', houseId)),
        getDocs(query(collection(db, 'pagos'), where('houseId', '==', houseId))),
      ]);
      if (houseSnap.exists()) {
        setHouseAddress(houseSnap.data()?.address ?? '');
      }
      const list: PagoItem[] = pagosSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            fechaPago: data.fechaPago ?? '',
            mora: parseMoneyField(data.mora),
            consumo: parseMoneyField(data.consumo),
            cuotaMantenimiento: parseMoneyField(data.cuotaMantenimiento),
            total: parseMoneyField(data.total),
            pago: parseMoneyField(data.pago),
            diferencia: parseMoneyField(data.diferencia),
          };
        })
        .sort((a, b) => b.fechaPago.localeCompare(a.fechaPago));
      setPagos(list);
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los pagos.');
      setPagos([]);
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

  const renderItem = ({ item }: { item: PagoItem }) => (
    <View style={[styles.row, { backgroundColor: colorScheme === 'dark' ? '#2a2a2a' : '#f5f5f5' }]}>
      <View style={styles.rowMain}>
        <ThemedText style={styles.fecha}>{item.fechaPago || '(Sin fecha)'}</ThemedText>
        <ThemedText style={styles.detail}>Total: {formatMoney(item.total)}</ThemedText>
        <ThemedText style={styles.detail}>Pago: {formatMoney(item.pago)}</ThemedText>
        <ThemedText style={styles.detail}>Diferencia: {formatMoney(item.diferencia)}</ThemedText>
      </View>
      <GesturePressable
        style={[styles.smallBtn, { borderColor: tintColor }]}
        onPress={() => router.push(`/(admin)/pago-edit?id=${item.id}` as const)}
      >
        <ThemedText style={[styles.smallBtnText, { color: tintColor }]}>Editar</ThemedText>
      </GesturePressable>
    </View>
  );

  if (loading && pagos.length === 0) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
        <ThemedText style={styles.loadingText}>Cargando pagos...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ThemedText type="title" style={styles.title}>
          Pagos
        </ThemedText>
        <ThemedText style={styles.subtitle} numberOfLines={2}>
          {houseAddress || '(Casa)'}
        </ThemedText>
        <ThemedText style={styles.hint}>Pagos registrados para esta casa.</ThemedText>
        {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

        <FlatList
          data={pagos}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tintColor} />
          }
          ListEmptyComponent={
            <ThemedText style={styles.empty}>No hay pagos registrados para esta casa.</ThemedText>
          }
        />

        <GesturePressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Volver a casas</ThemedText>
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
    marginRight: 12,
  },
  fecha: {
    fontSize: 16,
    fontWeight: '600',
  },
  detail: {
    fontSize: 13,
    opacity: 0.8,
    marginTop: 2,
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
