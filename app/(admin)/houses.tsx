import { collection, getDocs } from 'firebase/firestore';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { db } from '@/lib/firebase';

interface HouseItem {
  id: string;
  address: string;
  meterNumber: string;
}

export default function HousesScreen() {
  const insets = useSafeAreaInsets();
  const [houses, setHouses] = useState<HouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;

  const loadHouses = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'houses'));
      const list: HouseItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          address: data.address ?? '',
          meterNumber: data.meterNumber ?? '',
        };
      });
      setHouses(list.sort((a, b) => a.address.localeCompare(b.address)));
    } catch (err) {
      console.error(err);
      setHouses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHouses();
  }, [loadHouses]);

  const renderItem = ({ item }: { item: HouseItem }) => (
    <View style={[styles.row, { backgroundColor: colorScheme === 'dark' ? '#2a2a2a' : '#f5f5f5' }]}>
      <GesturePressable
        style={styles.rowMain}
        onPress={() => router.push({ pathname: '/(admin)/house-edit', params: { id: item.id } })}
      >
        <ThemedText style={styles.address}>{item.address || '(Sin dirección)'}</ThemedText>
        <ThemedText style={styles.meter}>Medidor: {item.meterNumber || '—'}</ThemedText>
      </GesturePressable>
      <View style={styles.rowActions}>
        <GesturePressable
          style={[styles.rowBtn, { borderColor: tintColor }]}
          onPress={() => router.push(`/(admin)/house-readings?id=${item.id}` as const)}
        >
          <ThemedText style={[styles.rowBtnText, { color: tintColor }]}>Lecturas</ThemedText>
        </GesturePressable>
        <GesturePressable
          style={[styles.rowBtn, { borderColor: tintColor }]}
          onPress={() => router.push({ pathname: '/(admin)/house-edit', params: { id: item.id } })}
        >
          <ThemedText style={[styles.rowBtnText, { color: tintColor }]}>Editar</ThemedText>
        </GesturePressable>
      </View>
    </View>
  );

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
        <ThemedText style={styles.loadingText}>Cargando casas...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ThemedText type="title" style={styles.title}>
        Casas
      </ThemedText>
      <ThemedText style={styles.subtitle}>Crear o editar casas (dirección y número de medidor).</ThemedText>

      <FlatList
        data={houses}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + insets.bottom }]}
        ListEmptyComponent={
          <ThemedText style={styles.empty}>No hay casas. Pulsa "Nueva casa" para crear una.</ThemedText>
        }
      />

      <GesturePressable
        style={[styles.addButton, { backgroundColor: tintColor }]}
        onPress={() => router.push('/(admin)/house-edit')}
      >
        <ThemedText style={[styles.addButtonText, { color: colorScheme === 'dark' ? '#111' : '#fff' }]}>
          Nueva casa
        </ThemedText>
      </GesturePressable>
      <GesturePressable style={[styles.backLink, { marginBottom: insets.bottom }]} onPress={() => router.back()}>
        <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Volver al panel</ThemedText>
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
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    marginBottom: 20,
    opacity: 0.8,
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
  rowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  rowBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  rowBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  address: {
    fontSize: 16,
    fontWeight: '500',
  },
  meter: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
  empty: {
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 24,
  },
  addButton: {
    height: 48,
    paddingHorizontal: 15,
    borderRadius: 12,
    justifyContent: 'center',
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
