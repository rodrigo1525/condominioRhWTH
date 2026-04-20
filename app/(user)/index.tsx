import { router } from 'expo-router';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { db } from '@/lib/firebase';

interface HouseItem {
  id: string;
  address: string;
  meterNumber: string;
}

export default function UserHomeScreen() {
  const insets = useSafeAreaInsets();
  const { logout, profile, isLoggingOut, error } = useAuth();
  const [houses, setHouses] = useState<HouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const loadMyHouses = useCallback(async () => {
    if (!profile?.uid) return;
    setLoading(true);
    setListError(null);
    try {
      const q = query(
        collection(db, 'houses'),
        where('userId', '==', profile.uid)
      );
      const snap = await getDocs(q);
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
      setListError('No se pudieron cargar tus casas.');
      setHouses([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.uid]);

  useEffect(() => {
    loadMyHouses();
  }, [loadMyHouses]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMyHouses();
    setRefreshing(false);
  }, [loadMyHouses]);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/(auth)');
    } catch {
      // Error mostrado en context
    }
  };

  const renderItem = ({ item }: { item: HouseItem }) => (
    <GesturePressable
      style={[styles.row, { backgroundColor: colorScheme === 'dark' ? '#2a2a2a' : '#f5f5f5' }]}
      onPress={() => router.push(`/(user)/house/${item.id}` as const)}
    >
      <View style={styles.rowMain}>
        <ThemedText style={styles.address}>{item.address || '(Sin dirección)'}</ThemedText>
        <ThemedText style={styles.meter}>Medidor: {item.meterNumber || '—'}</ThemedText>
      </View>
      <ThemedText style={[styles.chevron, { color: tintColor }]}>Ver consumo</ThemedText>
    </GesturePressable>
  );

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
        <ThemedText style={styles.loadingText}>Cargando...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ThemedText type="title" style={styles.title}>
        Mi consumo
      </ThemedText>
      <ThemedText style={styles.subtitle}>
        Bienvenido, {profile?.email ?? 'Usuario'}
      </ThemedText>
      {listError ? (
        <ThemedText style={styles.errorText}>{listError}</ThemedText>
      ) : null}
      {error ? (
        <ThemedText style={styles.errorText}>{error}</ThemedText>
      ) : null}

      <FlatList
        data={houses}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tintColor} />
        }
        ListEmptyComponent={
          <ThemedText style={styles.empty}>
            No tienes ninguna casa asignada. Contacta al administrador.
          </ThemedText>
        }
      />

      <GesturePressable
        onPress={handleLogout}
        disabled={isLoggingOut}
        style={[styles.logoutButton, { backgroundColor: tintColor, opacity: isLoggingOut ? 0.7 : 1, marginBottom: insets.bottom }]}
      >
        {isLoggingOut ? (
          <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
        ) : (
          <ThemedText style={[styles.logoutText, { color: isDark ? '#111' : '#fff' }]}>
            Cerrar sesión
          </ThemedText>
        )}
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
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 16,
    opacity: 0.8,
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
  address: {
    fontSize: 16,
    fontWeight: '500',
  },
  meter: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
  chevron: {
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 24,
  },
  logoutButton: {
    height: 48,
    width: '100%',
    paddingHorizontal: 15,
    borderRadius: 12,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#dc3545',
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
});
