import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { db } from '@/lib/firebase';
import {
  formatMoneyInput,
  parseMoneyField,
  roundMoney,
  toFirestorePagoMoney,
  toPagoMoneyFields,
  validatePagoMoneyFields,
} from '@/lib/money-utils';
import { buildPagosDiferenciaByPeriod, getSaldoAnteriorFromPagos } from '@/lib/period-utils';

const VARIABLES_DOC_PATH = ['variables', 'config'] as const;

interface HouseItem {
  id: string;
  address: string;
  meterNumber: string;
}

interface ReadingItem {
  id: string;
  period: string;
  consumption: number | null;
  hasPago: boolean;
}

interface CondominioVariables {
  cuotaMantenimiento: number;
  precioM3: number;
  precioMora: number;
  diaCorte: number;
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateISO(str: string): Date | null {
  const trimmed = str.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10) - 1;
  const d = parseInt(match[3], 10);
  const date = new Date(y, m, d);
  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) return null;
  return date;
}

function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const num = parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

function parseOptionalDecimal(value: string): number {
  return parseDecimal(value) ?? 0;
}

function formatSaldoAnteriorDisplay(amount: number, exists: boolean): string {
  if (!exists) return '—';
  if (amount < 0) return `(${formatMoneyInput(Math.abs(amount))})`;
  return formatMoneyInput(amount);
}

function computeConsumoPago(consumptionM3: number | null, precioM3: number): number | null {
  if (consumptionM3 === null) return null;
  return roundMoney(consumptionM3 * precioM3);
}

function getCutDate(paymentDate: Date, diaCorte: number): Date {
  const year = paymentDate.getFullYear();
  const month = paymentDate.getMonth();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const lastDay = new Date(prevYear, prevMonth + 1, 0).getDate();
  const day = Math.min(diaCorte, lastDay);
  return new Date(prevYear, prevMonth, day);
}

function daysLate(paymentDate: Date, cutDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = paymentDate.getTime() - cutDate.getTime();
  return Math.max(0, Math.floor(diff / msPerDay));
}

function formatMoney(value: number, moneda?: string): string {
  const formatted = value.toFixed(2);
  return moneda ? `${moneda} ${formatted}` : formatted;
}

export default function RegistrarPagoScreen() {
  const insets = useSafeAreaInsets();
  const { readingId: paramReadingId } = useLocalSearchParams<{ readingId?: string }>();
  const [houses, setHouses] = useState<HouseItem[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [houseDropdownOpen, setHouseDropdownOpen] = useState(false);
  const [readings, setReadings] = useState<ReadingItem[]>([]);
  const [pagosByPeriod, setPagosByPeriod] = useState<Map<string, number>>(new Map());
  const [selectedReadingId, setSelectedReadingId] = useState<string | null>(null);
  const [loadingReadings, setLoadingReadings] = useState(false);
  const [fechaPago, setFechaPago] = useState(formatDateISO(new Date()));
  const [moraInput, setMoraInput] = useState('');
  const [consumoInput, setConsumoInput] = useState('');
  const [consumptionM3, setConsumptionM3] = useState<number | null>(null);
  const [variables, setVariables] = useState<CondominioVariables | null>(null);
  const [moneda, setMoneda] = useState('');
  const [pago, setPago] = useState('');
  const [otrosInput, setOtrosInput] = useState('');
  const [ajustesInput, setAjustesInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [housesSnap, varsSnap] = await Promise.all([
        getDocs(collection(db, 'houses')),
        getDoc(doc(db, ...VARIABLES_DOC_PATH)),
      ]);

      const list: HouseItem[] = housesSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            address: data.address ?? '',
            meterNumber: data.meterNumber ?? '',
          };
        })
        .sort((a, b) => a.address.localeCompare(b.address));
      setHouses(list);
      if (list.length === 1) setSelectedHouseId(list[0].id);

      if (varsSnap.exists()) {
        const data = varsSnap.data();
        if (
          typeof data.cuotaMantenimiento === 'number' &&
          typeof data.precioM3 === 'number' &&
          typeof data.precioMora === 'number' &&
          typeof data.diaCorte === 'number'
        ) {
          setVariables({
            cuotaMantenimiento: parseMoneyField(data.cuotaMantenimiento),
            precioM3: parseMoneyField(data.precioM3),
            precioMora: parseMoneyField(data.precioMora),
            diaCorte: data.diaCorte,
          });
        }
        if (typeof data.moneda === 'string') {
          setMoneda(data.moneda);
        }
      }
    } catch {
      setError('Error al cargar datos iniciales.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!paramReadingId || houses.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'readings', paramReadingId));
        if (cancelled || !snap.exists()) return;
        const houseId = snap.data().houseId;
        if (typeof houseId === 'string' && houseId) {
          setSelectedHouseId(houseId);
        }
      } catch {
        if (!cancelled) {
          setError('No se pudo cargar la lectura indicada.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramReadingId, houses.length]);

  const loadHouseReadings = useCallback(
    async (houseId: string) => {
      setLoadingReadings(true);
      setReadings([]);
      setPagosByPeriod(new Map());
      setSelectedReadingId(null);
      setConsumptionM3(null);
      setConsumoInput('');
      try {
        const [readingsSnap, pagosSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, 'readings'),
              where('houseId', '==', houseId),
              orderBy('period', 'desc')
            )
          ),
          getDocs(query(collection(db, 'pagos'), where('houseId', '==', houseId))),
        ]);

        const paidReadingIds = new Set<string>();
        const pagosForLookup: Array<{ period?: string; fechaPago?: string; diferencia?: number }> =
          [];
        pagosSnap.docs.forEach((d) => {
          const data = d.data();
          pagosForLookup.push({
            period: typeof data.period === 'string' ? data.period : undefined,
            fechaPago: data.fechaPago ?? '',
            diferencia: typeof data.diferencia === 'number' ? data.diferencia : 0,
          });
          const readingId = data.readingId;
          if (typeof readingId === 'string') {
            paidReadingIds.add(readingId);
          }
        });
        setPagosByPeriod(buildPagosDiferenciaByPeriod(pagosForLookup));

        const list: ReadingItem[] = readingsSnap.docs
          .map((d) => {
            const data = d.data();
            let consumption: number | null = null;
            if (typeof data.consumption === 'number') {
              consumption = data.consumption;
            } else if (
              typeof data.value === 'number' &&
              typeof data.previousValue === 'number'
            ) {
              consumption = roundMoney(data.value - data.previousValue);
            }
            return {
              id: d.id,
              period: data.period ?? '',
              consumption,
              hasPago: paidReadingIds.has(d.id),
            };
          })
          .filter((reading) => reading.period);

        setReadings(list);

        const preferred =
          (paramReadingId && list.find((r) => r.id === paramReadingId && !r.hasPago)?.id) ||
          list.find((r) => !r.hasPago)?.id ||
          list[0]?.id ||
          null;
        setSelectedReadingId(preferred);
      } catch {
        setError(
          'No se pudieron cargar las lecturas de la casa. Verifica el índice de readings en Firestore.'
        );
      } finally {
        setLoadingReadings(false);
      }
    },
    [paramReadingId]
  );

  useEffect(() => {
    if (!selectedHouseId) {
      setReadings([]);
      setPagosByPeriod(new Map());
      setSelectedReadingId(null);
      setConsumptionM3(null);
      setConsumoInput('');
      return;
    }
    loadHouseReadings(selectedHouseId);
  }, [selectedHouseId, loadHouseReadings]);

  useEffect(() => {
    const reading = readings.find((r) => r.id === selectedReadingId);
    if (!reading) {
      setConsumptionM3(null);
      return;
    }
    setConsumptionM3(reading.consumption);
  }, [selectedReadingId, readings]);

  const paymentDate = useMemo(() => parseDateISO(fechaPago), [fechaPago]);

  const calculatedMora = useMemo(() => {
    if (!variables || !paymentDate) return 0;
    const cutDate = getCutDate(paymentDate, variables.diaCorte);
    const days = daysLate(paymentDate, cutDate);
    return roundMoney(days * variables.precioMora);
  }, [variables, paymentDate]);

  const calculatedConsumo = useMemo(() => {
    if (!variables) return 0;
    return computeConsumoPago(consumptionM3, variables.precioM3) ?? 0;
  }, [variables, consumptionM3]);

  useEffect(() => {
    setMoraInput(formatMoneyInput(calculatedMora));
  }, [calculatedMora]);

  useEffect(() => {
    if (!selectedReadingId || loadingReadings) return;
    setConsumoInput(formatMoneyInput(calculatedConsumo));
  }, [calculatedConsumo, selectedReadingId, loadingReadings]);

  const mantenimiento = useMemo(() => {
    return variables ? roundMoney(variables.cuotaMantenimiento) : 0;
  }, [variables]);

  const saldoAnteriorInfo = useMemo(() => {
    const reading = readings.find((r) => r.id === selectedReadingId);
    if (!reading?.period) {
      return { amount: 0, exists: false, periodoAnterior: '' };
    }
    return getSaldoAnteriorFromPagos(pagosByPeriod, reading.period);
  }, [readings, selectedReadingId, pagosByPeriod]);

  const saldoAnteriorAmount = saldoAnteriorInfo.exists
    ? roundMoney(saldoAnteriorInfo.amount)
    : undefined;

  const moneyFields = useMemo(
    () =>
      toPagoMoneyFields({
        mora: parseDecimal(moraInput) ?? 0,
        consumo: parseDecimal(consumoInput) ?? 0,
        cuotaMantenimiento: mantenimiento,
        otros: parseOptionalDecimal(otrosInput),
        ajustes: parseOptionalDecimal(ajustesInput),
        pago: parseDecimal(pago) ?? 0,
        saldoAnterior: saldoAnteriorAmount,
      }),
    [
      moraInput,
      consumoInput,
      mantenimiento,
      otrosInput,
      ajustesInput,
      pago,
      saldoAnteriorAmount,
    ]
  );

  const { total, diferencia } = moneyFields;

  const handleSave = async () => {
    if (!selectedHouseId) {
      setError('Selecciona una casa.');
      return;
    }
    if (!selectedReadingId) {
      setError('Selecciona la lectura que estás pagando.');
      return;
    }
    const selectedReading = readings.find((r) => r.id === selectedReadingId);
    if (!selectedReading) {
      setError('La lectura seleccionada no es válida.');
      return;
    }
    if (selectedReading.hasPago) {
      setError('Esta lectura ya tiene un pago registrado.');
      return;
    }
    if (!paymentDate) {
      setError('La fecha del pago debe tener formato AAAA-MM-DD.');
      return;
    }
    if (!variables) {
      setError('Configura las variables del condominio antes de registrar pagos.');
      return;
    }
    const moraValue = parseDecimal(moraInput);
    const consumoValue = parseDecimal(consumoInput);
    if (moraValue === null || moraValue < 0) {
      setError('La mora debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (consumoValue === null || consumoValue < 0) {
      setError('El consumo debe ser un número decimal válido (≥ 0).');
      return;
    }
    const pagoValue = parseDecimal(pago);
    if (pagoValue === null || pagoValue < 0) {
      setError('El pago debe ser un número decimal válido (≥ 0).');
      return;
    }
    const otrosValue = parseOptionalDecimal(otrosInput);
    const ajustesValue = parseOptionalDecimal(ajustesInput);
    if (otrosInput.trim() && parseDecimal(otrosInput) === null) {
      setError('Otro debe ser un número decimal válido.');
      return;
    }
    if (ajustesInput.trim() && parseDecimal(ajustesInput) === null) {
      setError('Ajuste JD debe ser un número decimal válido.');
      return;
    }

    const moneyFieldsToSave = toPagoMoneyFields({
      mora: moraValue,
      consumo: consumoValue,
      cuotaMantenimiento: mantenimiento,
      otros: otrosValue,
      ajustes: ajustesValue,
      pago: pagoValue,
      saldoAnterior: saldoAnteriorAmount,
    });

    if (moneyFieldsToSave.total !== moneyFields.total) {
      setError(
        `El total a guardar (${formatMoneyInput(moneyFieldsToSave.total)}) no coincide con el mostrado (${formatMoneyInput(moneyFields.total)}). Revisa los montos.`
      );
      return;
    }
    if (!validatePagoMoneyFields(moneyFieldsToSave)) {
      setError('Los montos del pago no cuadran. Revisa mora, consumo, total y pago.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const existingSnap = await getDocs(
        query(collection(db, 'pagos'), where('readingId', '==', selectedReadingId))
      );
      if (!existingSnap.empty) {
        setError('Ya existe un pago registrado para esta lectura.');
        return;
      }

      await addDoc(collection(db, 'pagos'), {
        readingId: selectedReadingId,
        period: selectedReading.period,
        houseId: selectedHouseId,
        fechaPago,
        periodoSaldoAnterior: saldoAnteriorInfo.exists ? saldoAnteriorInfo.periodoAnterior : null,
        createdAt: new Date(),
        ...toFirestorePagoMoney(moneyFieldsToSave),
      });
      Alert.alert('Éxito', 'Pago registrado correctamente.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      setError('Error al guardar el pago. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
      </ThemedView>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
  ];
  const readOnlyStyle = [
    styles.input,
    styles.inputReadOnly,
    { backgroundColor: isDark ? '#222' : '#e8e8e8', color: isDark ? '#ccc' : '#444' },
  ];

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + insets.bottom }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ThemedText type="title" style={styles.title}>
              Registrar pago
            </ThemedText>

            {error ? (
              <View style={styles.errorBox}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </View>
            ) : null}

            {!variables ? (
              <View style={styles.warningBox}>
                <ThemedText style={styles.warningText}>
                  Configura las variables (cuota, precios y día corte) antes de registrar pagos.
                </ThemedText>
              </View>
            ) : null}

            <ThemedText style={styles.label}>Casa</ThemedText>
            <Pressable
              style={[
                styles.dropdown,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', borderColor: tintColor },
              ]}
              onPress={() => houses.length > 0 && setHouseDropdownOpen(true)}
              disabled={houses.length === 0 || saving}
            >
              <ThemedText
                style={[styles.dropdownText, { color: isDark ? '#fff' : '#111' }]}
                numberOfLines={1}
              >
                {selectedHouseId
                  ? houses.find((h) => h.id === selectedHouseId)?.address ||
                    houses.find((h) => h.id === selectedHouseId)?.meterNumber ||
                    selectedHouseId
                  : 'Seleccionar casa...'}
              </ThemedText>
              <ThemedText style={styles.dropdownChevron}>▼</ThemedText>
            </Pressable>

            <Modal
              visible={houseDropdownOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setHouseDropdownOpen(false)}
            >
              <Pressable style={styles.modalOverlay} onPress={() => setHouseDropdownOpen(false)}>
                <View
                  style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                  onStartShouldSetResponder={() => true}
                >
                  <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                    {houses.map((h, index) => (
                      <Pressable
                        key={h.id}
                        style={[
                          styles.dropdownOption,
                          index === houses.length - 1 && styles.dropdownOptionLast,
                          selectedHouseId === h.id && { backgroundColor: tintColor + '30' },
                        ]}
                        onPress={() => {
                          setSelectedHouseId(h.id);
                          setHouseDropdownOpen(false);
                        }}
                      >
                        <ThemedText
                          style={selectedHouseId === h.id ? styles.dropdownOptionTextActive : undefined}
                          numberOfLines={1}
                        >
                          {h.address || h.meterNumber || h.id}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </Pressable>
            </Modal>

            <ThemedText style={styles.label}>Saldo anterior</ThemedText>
            <TextInput
              style={readOnlyStyle}
              value={
                !selectedReadingId || loadingReadings
                  ? '—'
                  : formatSaldoAnteriorDisplay(saldoAnteriorInfo.amount, saldoAnteriorInfo.exists)
              }
              editable={false}
            />
            {selectedReadingId && saldoAnteriorInfo.exists ? (
              <ThemedText style={styles.hint}>
                Diferencia del pago de {saldoAnteriorInfo.periodoAnterior}
              </ThemedText>
            ) : selectedReadingId && !loadingReadings ? (
              <ThemedText style={styles.hint}>
                Sin diferencia pendiente del período anterior
              </ThemedText>
            ) : null}

            <ThemedText style={styles.label}>Fecha del pago</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="AAAA-MM-DD"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={fechaPago}
              onChangeText={setFechaPago}
              editable={!saving}
              autoCapitalize="none"
            />

            <ThemedText style={styles.label}>Mora</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="0.00"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={moraInput}
              onChangeText={setMoraInput}
              keyboardType="decimal-pad"
              editable={!saving}
            />
            {variables && paymentDate ? (
              <ThemedText style={styles.hint}>
                Sugerido: días desde corte ({formatDateISO(getCutDate(paymentDate, variables.diaCorte))}) × precio mora
              </ThemedText>
            ) : null}

            <ThemedText style={styles.label}>Consumo</ThemedText>
            <TextInput
              style={[
                inputStyle,
                (!selectedReadingId || loadingReadings) && styles.inputDisabled,
              ]}
              placeholder={
                !selectedReadingId
                  ? 'Selecciona una lectura'
                  : loadingReadings
                    ? 'Calculando...'
                    : '0.00'
              }
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={consumoInput}
              onChangeText={setConsumoInput}
              keyboardType="decimal-pad"
              editable={!!selectedReadingId && !saving && !loadingReadings}
            />
            {selectedReadingId && consumptionM3 !== null && variables ? (
              <ThemedText style={styles.hint}>
                Sugerido: {consumptionM3} M³ × precio M³ ({variables.precioM3.toFixed(2)})
              </ThemedText>
            ) : null}

            <ThemedText style={styles.label}>Mantenimiento</ThemedText>
            <TextInput
              style={readOnlyStyle}
              value={formatMoney(mantenimiento, moneda)}
              editable={false}
            />

            <ThemedText style={styles.label}>Otro</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="0.00"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={otrosInput}
              onChangeText={setOtrosInput}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Ajuste JD</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="0.00"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={ajustesInput}
              onChangeText={setAjustesInput}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Total</ThemedText>
            <TextInput
              style={readOnlyStyle}
              value={moneda ? `${moneda} ${formatMoneyInput(total)}` : formatMoneyInput(total)}
              editable={false}
            />

            <ThemedText style={styles.hint}>
              Mora + consumo (incluye saldo anterior) + mantenimiento + otro + ajuste JD
            </ThemedText>

            <ThemedText style={styles.label}>Pago</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="Ej: 250.00"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={pago}
              onChangeText={setPago}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Diferencia</ThemedText>
            <TextInput
              style={readOnlyStyle}
              value={moneda ? `${moneda} ${formatMoneyInput(diferencia)}` : formatMoneyInput(diferencia)}
              editable={false}
            />
            <ThemedText style={styles.hint}>Total − pago</ThemedText>

            <GesturePressable
              style={[styles.button, { backgroundColor: tintColor }]}
              onPress={handleSave}
              disabled={saving || !variables}
            >
              {saving ? (
                <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
              ) : (
                <ThemedText style={[styles.buttonText, { color: isDark ? '#111' : '#fff' }]}>
                  Guardar pago
                </ThemedText>
              )}
            </GesturePressable>

            <GesturePressable style={styles.backLink} onPress={() => router.back()}>
              <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Volver al panel</ThemedText>
            </GesturePressable>
          </ScrollView>
        </KeyboardAvoidingView>
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
  },
  keyboardView: {
    flex: 1,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  title: {
    textAlign: 'center',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: -8,
    marginBottom: 16,
  },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  inputReadOnly: {
    opacity: 0.9,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  dropdown: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    marginBottom: 16,
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
  errorBox: {
    backgroundColor: 'rgba(220, 53, 69, 0.15)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 14,
  },
  warningBox: {
    backgroundColor: 'rgba(255, 193, 7, 0.15)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  warningText: {
    color: '#856404',
    fontSize: 14,
  },
  button: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
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
