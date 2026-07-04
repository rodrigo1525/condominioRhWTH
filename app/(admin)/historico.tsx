import { collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { db, functions } from '@/lib/firebase';

const MONTHS = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

interface HouseItem {
  id: string;
  address: string;
  meterNumber: string;
  email?: string | null;
}

interface ReadingResult {
  id: string;
  houseId: string;
  address: string;
  period: string;
  value: number;
  previousValue: number | null;
  consumption: number | null;
  photoUrl: string | null;
  email: string | null;
}

function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  const monthName = MONTHS[parseInt(m, 10) - 1]?.label ?? m;
  return `${monthName} ${y}`;
}

function getSendEmailErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code);
    const message =
      typeof (err as { message?: string }).message === 'string'
        ? (err as unknown as { message: string }).message
        : '';
    if (code === 'functions/not-found' || message.toLowerCase().includes('not found')) {
      return (
        'La función sendHistoricoByEmail no está desplegada. En la raíz del proyecto ejecuta ' +
        '"firebase deploy --only functions".'
      );
    }
    if (code === 'functions/failed-precondition') {
      return message || 'Correo no configurado en Firebase Functions (SMTP_HOST, SMTP_USER, SMTP_PASS).';
    }
    if (message) return message;
  }
  return err instanceof Error ? err.message : 'Error al enviar el correo.';
}

export default function HistoricoScreen() {
  const insets = useSafeAreaInsets();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [sendByEmail, setSendByEmail] = useState(false);
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ReadingResult[]>([]);
  const [queriedPeriod, setQueriedPeriod] = useState<string | null>(null);

  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const years = useMemo(() => {
    const current = now.getFullYear();
    return Array.from({ length: 10 }, (_, i) => current - i);
  }, [now]);

  const period = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
  const selectedMonthLabel = MONTHS.find((m) => m.value === selectedMonth)?.label ?? '';

  const handleSubmit = useCallback(async () => {
    setError(null);
    setLoading(true);
    setResults([]);
    setQueriedPeriod(null);

    try {
      const [housesSnap, readingsSnap] = await Promise.all([
        getDocs(collection(db, 'houses')),
        getDocs(query(collection(db, 'readings'), where('period', '==', period))),
      ]);

      const housesMap = new Map<string, HouseItem>();
      housesSnap.docs.forEach((d) => {
        const data = d.data();
        housesMap.set(d.id, {
          id: d.id,
          address: data.address ?? '',
          meterNumber: data.meterNumber ?? '',
          email: data.email ?? null,
        });
      });

      const list: ReadingResult[] = readingsSnap.docs.map((d) => {
        const data = d.data();
        const house = housesMap.get(data.houseId ?? '');
        return {
          id: d.id,
          houseId: data.houseId ?? '',
          address: house?.address || house?.meterNumber || '(Sin dirección)',
          period: data.period ?? period,
          value: typeof data.value === 'number' ? data.value : 0,
          previousValue: data.previousValue ?? null,
          consumption: data.consumption ?? null,
          photoUrl: data.photoUrl ?? null,
          email: house?.email?.trim() || null,
        };
      });

      list.sort((a, b) => a.address.localeCompare(b.address));
      setResults(list);
      setQueriedPeriod(period);

      if (sendByEmail) {
        if (list.length === 0) {
          Alert.alert('Histórico', 'No hay lecturas para enviar por correo.');
        } else {
          try {
            const mesLabel = formatPeriod(period);
            const sendFn = httpsCallable<
              {
                mes: string;
                rows: Array<{
                  casaNo: string;
                  mes: string;
                  lecturaMesAnterior: string | number;
                  lecturaMesRegistrado: string | number;
                  consumo: string | number | null;
                }>;
              },
              { success: boolean; message?: string }
            >(functions, 'sendHistoricoByEmail');

            const { data } = await sendFn({
              mes: mesLabel,
              rows: list.map((reading) => ({
                casaNo: reading.address,
                mes: mesLabel,
                lecturaMesAnterior: reading.previousValue ?? '—',
                lecturaMesRegistrado: reading.value,
                consumo: reading.consumption,
              })),
            });

            Alert.alert('Envío por correo', data.message ?? 'Correo enviado correctamente.');
          } catch (err: unknown) {
            Alert.alert('Error', getSendEmailErrorMessage(err));
          }
        }
      }
    } catch (err) {
      console.error(err);
      setError('No se pudo cargar el histórico del período seleccionado.');
    } finally {
      setLoading(false);
    }
  }, [period, sendByEmail]);

  const renderResult = ({ item }: { item: ReadingResult }) => (
    <GesturePressable
      style={[styles.resultRow, { backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5' }]}
      onPress={() => router.push(`/(admin)/reading-detail?id=${item.id}` as const)}
    >
      <ThemedText style={styles.resultAddress}>{item.address}</ThemedText>
      <ThemedText style={styles.resultDetail}>Lectura: {item.value}</ThemedText>
      {item.previousValue != null && (
        <ThemedText style={styles.resultDetail}>Anterior: {item.previousValue}</ThemedText>
      )}
      {item.consumption != null && (
        <ThemedText style={styles.resultDetail}>Consumo: {item.consumption}</ThemedText>
      )}
    </GesturePressable>
  );

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + insets.bottom }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ThemedText type="title" style={styles.title}>
              Histórico
            </ThemedText>
            <ThemedText style={styles.subtitle}>
              Consulta las lecturas registradas por mes y año.
            </ThemedText>

            <ThemedText style={styles.label}>Mes</ThemedText>
            <Pressable
              style={[
                styles.dropdown,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', borderColor: tintColor },
              ]}
              onPress={() => setMonthDropdownOpen(true)}
            >
              <ThemedText style={[styles.dropdownText, { color: isDark ? '#fff' : '#111' }]}>
                {selectedMonthLabel}
              </ThemedText>
              <ThemedText style={styles.dropdownChevron}>▼</ThemedText>
            </Pressable>

            <ThemedText style={styles.label}>Año</ThemedText>
            <Pressable
              style={[
                styles.dropdown,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', borderColor: tintColor },
              ]}
              onPress={() => setYearDropdownOpen(true)}
            >
              <ThemedText style={[styles.dropdownText, { color: isDark ? '#fff' : '#111' }]}>
                {selectedYear}
              </ThemedText>
              <ThemedText style={styles.dropdownChevron}>▼</ThemedText>
            </Pressable>

            <Pressable
              style={styles.checkRow}
              onPress={() => setSendByEmail((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: sendByEmail }}
            >
              <View
                style={[
                  styles.checkbox,
                  { borderColor: tintColor },
                  sendByEmail && { backgroundColor: tintColor },
                ]}
              >
                {sendByEmail ? (
                  <ThemedText style={[styles.checkmark, { color: isDark ? '#111' : '#fff' }]}>✓</ThemedText>
                ) : null}
              </View>
              <ThemedText style={styles.checkLabel}>Enviar por email</ThemedText>
            </Pressable>

            {error ? (
              <View style={styles.errorBox}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </View>
            ) : null}

            <GesturePressable
              style={[styles.primaryButton, { backgroundColor: tintColor, opacity: loading ? 0.7 : 1 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
              ) : (
                <ThemedText style={[styles.primaryButtonText, { color: isDark ? '#111' : '#fff' }]}>
                  Consultar histórico
                </ThemedText>
              )}
            </GesturePressable>

            {queriedPeriod ? (
              <>
                <ThemedText style={styles.resultsTitle}>
                  Resultados — {formatPeriod(queriedPeriod)}
                </ThemedText>
                {results.length === 0 ? (
                  <ThemedText style={styles.empty}>
                    No hay lecturas registradas para este período.
                  </ThemedText>
                ) : (
                  <FlatList
                    data={results}
                    keyExtractor={(item) => item.id}
                    renderItem={renderResult}
                    scrollEnabled={false}
                    contentContainerStyle={styles.resultsList}
                  />
                )}
              </>
            ) : null}

            <GesturePressable style={styles.backLink} onPress={() => router.back()}>
              <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Volver al panel</ThemedText>
            </GesturePressable>
          </ScrollView>
        </KeyboardAvoidingView>

        <Modal
          visible={monthDropdownOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMonthDropdownOpen(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setMonthDropdownOpen(false)}>
            <View
              style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              onStartShouldSetResponder={() => true}
            >
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                {MONTHS.map((m, index) => (
                  <Pressable
                    key={m.value}
                    style={[
                      styles.dropdownOption,
                      index === MONTHS.length - 1 && styles.dropdownOptionLast,
                      selectedMonth === m.value && { backgroundColor: tintColor + '30' },
                    ]}
                    onPress={() => {
                      setSelectedMonth(m.value);
                      setMonthDropdownOpen(false);
                    }}
                  >
                    <ThemedText
                      style={selectedMonth === m.value ? styles.dropdownOptionTextActive : undefined}
                    >
                      {m.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

        <Modal
          visible={yearDropdownOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setYearDropdownOpen(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setYearDropdownOpen(false)}>
            <View
              style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              onStartShouldSetResponder={() => true}
            >
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                {years.map((y, index) => (
                  <Pressable
                    key={y}
                    style={[
                      styles.dropdownOption,
                      index === years.length - 1 && styles.dropdownOptionLast,
                      selectedYear === y && { backgroundColor: tintColor + '30' },
                    ]}
                    onPress={() => {
                      setSelectedYear(y);
                      setYearDropdownOpen(false);
                    }}
                  >
                    <ThemedText
                      style={selectedYear === y ? styles.dropdownOptionTextActive : undefined}
                    >
                      {y}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
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
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  dropdown: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
  },
  dropdownText: {
    fontSize: 16,
    flex: 1,
  },
  dropdownChevron: {
    fontSize: 12,
    opacity: 0.7,
    marginLeft: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  checkLabel: {
    fontSize: 16,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(220, 53, 69, 0.15)',
    marginTop: 16,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 14,
    textAlign: 'center',
  },
  primaryButton: {
    height: 48,
    paddingHorizontal: 15,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 28,
    marginBottom: 12,
    textAlign: 'center',
  },
  resultsList: {
    gap: 0,
  },
  resultRow: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  resultAddress: {
    fontSize: 16,
    fontWeight: '500',
  },
  resultDetail: {
    fontSize: 13,
    opacity: 0.8,
    marginTop: 4,
  },
  empty: {
    textAlign: 'center',
    opacity: 0.7,
  },
  backLink: {
    alignSelf: 'center',
    marginTop: 24,
    height: 48,
    paddingHorizontal: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backLinkText: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalScroll: {
    maxHeight: 400,
  },
  dropdownOption: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  dropdownOptionLast: {
    borderBottomWidth: 0,
  },
  dropdownOptionTextActive: {
    fontWeight: '600',
  },
});
