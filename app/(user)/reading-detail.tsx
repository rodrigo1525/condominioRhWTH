import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    ScrollView,
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

function prevPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
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

export default function UserReadingDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id: readingId } = useLocalSearchParams<{ id: string }>();
  const [houseLabel, setHouseLabel] = useState<string>('');
  const [period, setPeriod] = useState<string>('');
  const [value, setValue] = useState<number | null>(null);
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [consumption, setConsumption] = useState<number | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [prevPhotoUrl, setPrevPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const load = useCallback(async () => {
    if (!readingId) return;
    setError(null);
    setLoading(true);
    try {
      const readingSnap = await getDoc(doc(db, 'readings', readingId));
      if (!readingSnap.exists()) {
        setError('Lectura no encontrada.');
        return;
      }
      const r = readingSnap.data();
      const houseId = r.houseId as string;
      const p = (r.period as string) ?? '';
      const v = typeof r.value === 'number' ? r.value : null;
      const pv = r.previousValue != null ? (r.previousValue as number) : null;
      const cons = r.consumption != null ? (r.consumption as number) : null;
      const photo = (r.photoUrl as string) ?? null;

      setPeriod(p);
      setValue(v);
      setPreviousValue(pv);
      setConsumption(cons);
      setPhotoUrl(photo);

      const houseSnap = await getDoc(doc(db, 'houses', houseId));
      const houseData = houseSnap.exists() ? houseSnap.data() : null;
      setHouseLabel(
        houseData?.address ?? houseData?.meterNumber ?? houseId ?? '—'
      );

      const prevP = prevPeriod(p);
      const prevQuery = query(
        collection(db, 'readings'),
        where('houseId', '==', houseId),
        where('period', '==', prevP)
      );
      const prevSnap = await getDocs(prevQuery);
      const prevDoc = prevSnap.docs[0];
      if (prevDoc) {
        setPrevPhotoUrl(prevDoc.data().photoUrl ?? null);
      } else {
        setPrevPhotoUrl(null);
      }
    } catch (err) {
      console.error(err);
      setError('Error al cargar la lectura.');
    } finally {
      setLoading(false);
    }
  }, [readingId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
        <ThemedText style={styles.loadingText}>Cargando detalle...</ThemedText>
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.errorText}>{error}</ThemedText>
        <GesturePressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={[styles.backLinkText, { color: tintColor }]}>
            Volver
          </ThemedText>
        </GesturePressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="title" style={styles.title}>
          Detalle de lectura
        </ThemedText>
        <ThemedText style={styles.periodTitle}>{period ? formatPeriod(period) : '—'}</ThemedText>

        <View style={[styles.summaryCard, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}>
          <ThemedText style={styles.summaryTitle}>Resumen</ThemedText>
          <View style={styles.summaryRow}>
            <ThemedText style={styles.summaryLabel}>Casa</ThemedText>
            <ThemedText style={styles.summaryValue} numberOfLines={2}>{houseLabel}</ThemedText>
          </View>
          <View style={styles.summaryRow}>
            <ThemedText style={styles.summaryLabel}>
              Lectura {period ? formatPeriod(prevPeriod(period)) : '—'}
            </ThemedText>
            <ThemedText style={styles.summaryValue}>
              {previousValue != null ? String(previousValue) : '—'}
            </ThemedText>
          </View>
          <View style={styles.summaryRow}>
            <ThemedText style={styles.summaryLabel}>
              Lectura {period ? formatPeriod(period) : '—'}
            </ThemedText>
            <ThemedText style={styles.summaryValue}>
              {value != null ? String(value) : '—'}
            </ThemedText>
          </View>
          <View style={styles.summaryRow}>
            <ThemedText style={styles.summaryLabel}>Lo consumido</ThemedText>
            <ThemedText style={styles.summaryValue}>
              {consumption != null ? String(consumption) : '—'}
            </ThemedText>
          </View>
        </View>

        <ThemedText style={styles.sectionLabel}>Fotos del medidor</ThemedText>
        <View style={styles.imagesRow}>
          <View style={styles.imageBlock}>
            <ThemedText style={styles.imageCaption}>{period ? formatPeriod(prevPeriod(period)) : 'Mes anterior'}</ThemedText>
            {prevPhotoUrl ? (
              <Image
                source={{ uri: prevPhotoUrl }}
                style={styles.thumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.thumbPlaceholder, { borderColor: tintColor }]}>
                <ThemedText style={styles.placeholderText}>Sin foto</ThemedText>
              </View>
            )}
          </View>
          <View style={styles.imageBlock}>
            <ThemedText style={styles.imageCaption}>{period ? formatPeriod(period) : 'Mes del cálculo'}</ThemedText>
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.thumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.thumbPlaceholder, { borderColor: tintColor }]}>
                <ThemedText style={styles.placeholderText}>Sin foto</ThemedText>
              </View>
            )}
          </View>
        </View>

        <GesturePressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={[styles.backLinkText, { color: tintColor }]}>
            Volver al histórico
          </ThemedText>
        </GesturePressable>
      </ScrollView>
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
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
  },
  title: {
    marginBottom: 4,
    textAlign: 'center',
  },
  periodTitle: {
    fontSize: 16,
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: 20,
  },
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 14,
    opacity: 0.9,
    flex: 1,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 12,
    maxWidth: '50%',
    textAlign: 'right',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  imagesRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  imageBlock: {
    flex: 1,
  },
  imageCaption: {
    fontSize: 12,
    opacity: 0.8,
    marginBottom: 8,
  },
  thumb: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
  },
  thumbPlaceholder: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
    opacity: 0.6,
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
  errorText: {
    color: '#dc3545',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
});
