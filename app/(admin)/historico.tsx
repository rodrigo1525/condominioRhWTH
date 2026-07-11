import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { parseMoneyField } from '@/lib/money-utils';
import { getPreviousPeriod } from '@/lib/period-utils';

const VARIABLES_DOC_PATH = ['variables', 'config'] as const;

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

type ReportType = 'preliminar' | 'final';
type DropdownTarget = 'month' | 'year' | null;

interface HouseItem {
  id: string;
  address: string;
  meterNumber: string;
  email?: string | null;
}

interface PagoEntry {
  diferencia: number;
  pago: number;
  mora: number;
  otros: number;
  ajustes: number;
  cuotaMantenimiento: number;
  consumo: number;
  total: number;
  saldoAnterior: number;
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
  saldoAnterior: number | null;
  saldoAnteriorFormatted: string;
  cuotaMantenimiento: number;
  cuotaAPagarPorConsumoAgua: number;
  saldoTotalAPagar: number;
  pagoFinal: PagoEntry | null;
}

interface VariablesConfig {
  precioM3: number;
  cuotaMantenimiento: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface PagoLookup {
  byReadingId: Map<string, PagoEntry>;
  byHousePeriod: Map<string, Map<string, PagoEntry>>;
}

function buildPagoLookup(
  pagos: Array<{
    readingId?: string;
    houseId: string;
    period?: string;
    fechaPago: string;
    diferencia: number;
    pago: number;
    mora: number;
    otros: number;
    ajustes: number;
    cuotaMantenimiento: number;
    consumo: number;
    saldoAnterior?: number;
    total: number;
  }>
): PagoLookup {
  const byReadingId = new Map<string, PagoEntry>();
  const housePeriodRaw = new Map<string, Map<string, { fecha: string; entry: PagoEntry }>>();

  pagos.forEach((pago) => {
    if (!pago.houseId) return;

    const entry: PagoEntry = {
      diferencia: pago.diferencia,
      pago: pago.pago,
      mora: pago.mora,
      otros: pago.otros,
      ajustes: pago.ajustes,
      cuotaMantenimiento: pago.cuotaMantenimiento,
      consumo: pago.consumo,
      total: pago.total,
      saldoAnterior: typeof pago.saldoAnterior === 'number' ? pago.saldoAnterior : 0,
    };

    if (pago.readingId) {
      byReadingId.set(pago.readingId, entry);
    }

    const periodKey =
      (typeof pago.period === 'string' && pago.period) ||
      (pago.fechaPago.length >= 7 ? pago.fechaPago.slice(0, 7) : '');
    if (!periodKey) return;

    if (!housePeriodRaw.has(pago.houseId)) {
      housePeriodRaw.set(pago.houseId, new Map());
    }
    const houseMap = housePeriodRaw.get(pago.houseId)!;
    const existing = houseMap.get(periodKey);
    if (!existing || pago.fechaPago >= existing.fecha) {
      houseMap.set(periodKey, { fecha: pago.fechaPago, entry });
    }
  });

  const byHousePeriod = new Map<string, Map<string, PagoEntry>>();
  housePeriodRaw.forEach((houseMap, houseId) => {
    const flat = new Map<string, PagoEntry>();
    houseMap.forEach((value, periodKey) => flat.set(periodKey, value.entry));
    byHousePeriod.set(houseId, flat);
  });

  return { byReadingId, byHousePeriod };
}

function getPagoForReading(
  lookup: PagoLookup,
  readingId: string,
  houseId: string,
  readingPeriod: string
): PagoEntry | null {
  const byId = lookup.byReadingId.get(readingId);
  if (byId) return byId;
  return lookup.byHousePeriod.get(houseId)?.get(readingPeriod) ?? null;
}

function getSaldoAnterior(
  lookup: PagoLookup,
  houseId: string,
  readingPeriod: string
): { amount: number; exists: boolean } {
  const prevPeriod = getPreviousPeriod(readingPeriod);
  const entry = lookup.byHousePeriod.get(houseId)?.get(prevPeriod);
  if (!entry || entry.diferencia === 0) {
    return { amount: 0, exists: false };
  }
  return { amount: entry.diferencia, exists: true };
}

function formatReportDecimal(value: number): string {
  return round2(value).toFixed(2);
}

function formatReportOptionalDecimal(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatReportDecimal(value);
}

function formatReportOptionalCharge(value: number, hasValue: boolean): string {
  if (!hasValue || value === 0) return '';
  return formatSaldoMonetario(value, true);
}

function formatSaldoMonetario(amount: number, exists: boolean): string {
  if (!exists) return '—';
  if (amount < 0) {
    return `(${round2(Math.abs(amount)).toFixed(2)})`;
  }
  return round2(amount).toFixed(2);
}

function formatSaldoAnterior(amount: number, exists: boolean): string {
  return formatSaldoMonetario(amount, exists);
}

function computeCuotaAPagarPorConsumoAgua(
  consumption: number | null,
  precioM3: number,
  saldo: { amount: number; exists: boolean }
): number {
  const base = round2((consumption ?? 0) * precioM3);
  const saldoNumeric = saldo.exists ? saldo.amount : 0;
  return round2(base + saldoNumeric);
}

function computeSaldoTotalAPagar(cuotaAPagarPorConsumoAgua: number, cuotaMantenimiento: number): number {
  return round2(cuotaAPagarPorConsumoAgua + cuotaMantenimiento);
}

type ReporteEmailRow = {
  casaNo: string;
  saldoAnterior: string;
  cuotaAtraso: string;
  otro: string;
  ajusteJD: string;
  cuotaMantenimiento: string;
  lecturaAnterior: string;
  lecturaRegistrada: string;
  consumoAguaM3: string;
  cuotaAPagarPorConsumoAgua: string;
  saldoTotalAPagar: string;
  observaciones: string;
};

function buildPreliminarEmailRow(reading: ReadingResult): ReporteEmailRow {
  const saldoTotal = round2(reading.cuotaAPagarPorConsumoAgua + reading.cuotaMantenimiento);
  return {
    casaNo: reading.address,
    saldoAnterior: reading.saldoAnteriorFormatted,
    cuotaAtraso: '',
    otro: '',
    ajusteJD: '',
    cuotaMantenimiento: formatReportDecimal(reading.cuotaMantenimiento),
    lecturaAnterior: formatReportOptionalDecimal(reading.previousValue),
    lecturaRegistrada: formatReportDecimal(reading.value),
    consumoAguaM3: formatReportOptionalDecimal(reading.consumption),
    cuotaAPagarPorConsumoAgua: formatReportDecimal(reading.cuotaAPagarPorConsumoAgua),
    saldoTotalAPagar: formatReportDecimal(saldoTotal),
    observaciones: '',
  };
}

function buildFinalEmailRow(reading: ReadingResult): ReporteEmailRow {
  const pago = reading.pagoFinal;
  const exists = pago != null;
  const saldoTotal = exists ? round2(pago!.total) : 0;
  return {
    casaNo: reading.address,
    saldoAnterior: reading.saldoAnteriorFormatted,
    cuotaAtraso: formatSaldoMonetario(pago?.mora ?? 0, exists),
    otro: formatReportOptionalCharge(pago?.otros ?? 0, exists),
    ajusteJD: formatReportOptionalCharge(pago?.ajustes ?? 0, exists),
    cuotaMantenimiento: exists ? formatReportDecimal(pago!.cuotaMantenimiento) : '—',
    lecturaAnterior: formatReportOptionalDecimal(reading.previousValue),
    lecturaRegistrada: formatReportDecimal(reading.value),
    consumoAguaM3: formatReportOptionalDecimal(reading.consumption),
    cuotaAPagarPorConsumoAgua: exists ? formatReportDecimal(pago!.consumo) : '—',
    saldoTotalAPagar: exists ? formatReportDecimal(saldoTotal) : '—',
    observaciones: '',
  };
}

function getDefaultMonthYear(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  const monthName = MONTHS[parseInt(m, 10) - 1]?.label ?? m;
  return `${monthName} ${y}`;
}

function toPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
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
  const defaults = useMemo(() => getDefaultMonthYear(), []);

  const [selectedMonth, setSelectedMonth] = useState(defaults.month);
  const [selectedYear, setSelectedYear] = useState(defaults.year);
  const [reportType, setReportType] = useState<ReportType>('preliminar');
  const [variables, setVariables] = useState<VariablesConfig | null>(null);
  const [loadingVariables, setLoadingVariables] = useState(true);
  const [dropdownTarget, setDropdownTarget] = useState<DropdownTarget>(null);
  const [loading, setLoading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ReadingResult[]>([]);
  const [queriedPeriod, setQueriedPeriod] = useState<string | null>(null);

  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const now = new Date();
  const years = useMemo(() => {
    const current = now.getFullYear();
    return Array.from({ length: 10 }, (_, i) => current - i);
  }, [now]);

  const period = toPeriod(selectedYear, selectedMonth);
  const selectedMonthLabel = MONTHS.find((m) => m.value === selectedMonth)?.label ?? '';

  const loadVariables = useCallback(async () => {
    setLoadingVariables(true);
    try {
      const snap = await getDoc(doc(db, ...VARIABLES_DOC_PATH));
      if (snap.exists()) {
        const data = snap.data();
        setVariables({
          precioM3: typeof data.precioM3 === 'number' ? data.precioM3 : 0,
          cuotaMantenimiento:
            typeof data.cuotaMantenimiento === 'number' ? data.cuotaMantenimiento : 0,
        });
      } else {
        setVariables({ precioM3: 0, cuotaMantenimiento: 0 });
      }
    } catch {
      setVariables({ precioM3: 0, cuotaMantenimiento: 0 });
    } finally {
      setLoadingVariables(false);
    }
  }, []);

  useEffect(() => {
    loadVariables();
  }, [loadVariables]);

  const fetchReadings = useCallback(async (): Promise<ReadingResult[] | null> => {
    const precioM3 = variables?.precioM3 ?? 0;
    const cuotaMantenimiento = variables?.cuotaMantenimiento ?? 0;

    const [housesSnap, readingsSnap, pagosSnap] = await Promise.all([
      getDocs(collection(db, 'houses')),
      getDocs(query(collection(db, 'readings'), where('period', '==', period))),
      getDocs(collection(db, 'pagos')),
    ]);

    const pagoLookup = buildPagoLookup(
      pagosSnap.docs.map((d) => {
        const data = d.data();
        return {
          readingId: typeof data.readingId === 'string' ? data.readingId : undefined,
          houseId: data.houseId ?? '',
          period: typeof data.period === 'string' ? data.period : undefined,
          fechaPago: data.fechaPago ?? '',
          diferencia: parseMoneyField(data.diferencia),
          pago: parseMoneyField(data.pago),
          mora: parseMoneyField(data.mora),
          otros: parseMoneyField(data.otros),
          ajustes: parseMoneyField(data.ajustes),
          cuotaMantenimiento: parseMoneyField(data.cuotaMantenimiento),
          consumo: parseMoneyField(data.consumo),
          total: parseMoneyField(data.total),
          saldoAnterior: parseMoneyField(data.saldoAnterior),
        };
      })
    );

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
      const houseId = data.houseId ?? '';
      const house = housesMap.get(houseId);
      const period = data.period ?? '';
      const consumption = data.consumption ?? null;
      const saldo = getSaldoAnterior(pagoLookup, houseId, period);
      const cuotaAPagarPorConsumoAgua = computeCuotaAPagarPorConsumoAgua(
        consumption,
        precioM3,
        saldo
      );
      return {
        id: d.id,
        houseId,
        address: house?.address || house?.meterNumber || '(Sin dirección)',
        period,
        value: typeof data.value === 'number' ? data.value : 0,
        previousValue: data.previousValue ?? null,
        consumption,
        photoUrl: data.photoUrl ?? null,
        email: house?.email?.trim() || null,
        saldoAnterior: saldo.exists ? saldo.amount : null,
        saldoAnteriorFormatted: formatSaldoAnterior(saldo.amount, saldo.exists),
        cuotaMantenimiento,
        cuotaAPagarPorConsumoAgua,
        saldoTotalAPagar: computeSaldoTotalAPagar(cuotaAPagarPorConsumoAgua, cuotaMantenimiento),
        pagoFinal: getPagoForReading(pagoLookup, d.id, houseId, period),
      };
    });

    list.sort((a, b) => a.address.localeCompare(b.address));
    return list;
  }, [period, variables?.precioM3, variables?.cuotaMantenimiento]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setLoading(true);
    setResults([]);
    setQueriedPeriod(null);

    try {
      const list = await fetchReadings();
      if (list === null) return;
      setResults(list);
      setQueriedPeriod(period);
    } catch (err) {
      console.error(err);
      setError('No se pudo cargar el histórico del período seleccionado.');
    } finally {
      setLoading(false);
    }
  }, [fetchReadings, period]);

  const handleSendEmail = useCallback(async () => {
    setSendingEmail(true);
    setError(null);
    try {
      let list =
        queriedPeriod === period && results.length > 0 ? results : await fetchReadings();

      if (!list || list.length === 0) {
        Alert.alert('Envío por correo', 'No hay lecturas registradas para enviar en este período.');
        return;
      }

      const periodLabel = formatPeriod(period);
      const reportLabel = reportType === 'preliminar' ? 'Reporte preliminar' : 'Reporte final';
      const mesLabel = `${periodLabel} (${reportLabel})`;

      const sendFn = httpsCallable<
        {
          mes: string;
          reportType: ReportType;
          rows: ReporteEmailRow[];
        },
        { success: boolean; message?: string }
      >(functions, 'sendHistoricoByEmail');

      const { data } = await sendFn({
        mes: mesLabel,
        reportType,
        rows: list.map((reading) =>
          reportType === 'preliminar'
            ? buildPreliminarEmailRow(reading)
            : buildFinalEmailRow(reading)
        ),
      });

      Alert.alert('Envío por correo', data.message ?? 'Correo enviado correctamente.');
    } catch (err: unknown) {
      console.error(err);
      Alert.alert('Error', getSendEmailErrorMessage(err));
    } finally {
      setSendingEmail(false);
    }
  }, [fetchReadings, period, queriedPeriod, reportType, results]);

  const renderResult = ({ item }: { item: ReadingResult }) => {
    const reportRow =
      reportType === 'final' ? buildFinalEmailRow(item) : buildPreliminarEmailRow(item);

    return (
    <GesturePressable
      style={[styles.resultRow, { backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5' }]}
      onPress={() => router.push(`/(admin)/reading-detail?id=${item.id}` as const)}
    >
      <ThemedText style={styles.resultAddress}>{item.address}</ThemedText>
      <ThemedText style={styles.resultDetail}>Período: {formatPeriod(item.period)}</ThemedText>
      <ThemedText style={styles.resultDetail}>
        Lectura anterior: {reportRow.lecturaAnterior}
      </ThemedText>
      <ThemedText style={styles.resultDetail}>
        Lectura registrada: {reportRow.lecturaRegistrada}
      </ThemedText>
      <ThemedText style={styles.resultDetail}>Consumo M³: {reportRow.consumoAguaM3}</ThemedText>
      {reportType === 'preliminar' && (
        <>
          <ThemedText style={styles.resultDetail}>
            Saldo anterior: {reportRow.saldoAnterior}
          </ThemedText>
          <ThemedText style={styles.resultDetail}>
            Cuota mantenimiento: {reportRow.cuotaMantenimiento}
          </ThemedText>
          <ThemedText style={styles.resultDetail}>
            Cuota por consumo de agua: {reportRow.cuotaAPagarPorConsumoAgua}
          </ThemedText>
          <ThemedText style={styles.resultDetail}>
            Saldo total a pagar: {reportRow.saldoTotalAPagar}
          </ThemedText>
        </>
      )}
      {reportType === 'final' && (
        <>
          <ThemedText style={styles.resultDetail}>
            Saldo anterior: {reportRow.saldoAnterior}
          </ThemedText>
          <ThemedText style={styles.resultDetail}>Mora: {reportRow.cuotaAtraso}</ThemedText>
          {reportRow.otro ? (
            <ThemedText style={styles.resultDetail}>Otro: {reportRow.otro}</ThemedText>
          ) : null}
          {reportRow.ajusteJD ? (
            <ThemedText style={styles.resultDetail}>Ajuste JD: {reportRow.ajusteJD}</ThemedText>
          ) : null}
          <ThemedText style={styles.resultDetail}>
            Cuota mantenimiento: {reportRow.cuotaMantenimiento}
          </ThemedText>
          <ThemedText style={styles.resultDetail}>
            Cuota por consumo de agua: {reportRow.cuotaAPagarPorConsumoAgua}
          </ThemedText>
          <ThemedText style={styles.resultDetail}>
            Saldo total a pagar: {reportRow.saldoTotalAPagar}
          </ThemedText>
        </>
      )}
    </GesturePressable>
    );
  };

  const dropdownOptions = useMemo(() => {
    if (dropdownTarget === 'month') {
      return MONTHS.map((m) => ({
        key: String(m.value),
        label: m.label,
        selected: selectedMonth === m.value,
        onSelect: () => {
          setSelectedMonth(m.value);
          setDropdownTarget(null);
        },
      }));
    }
    if (dropdownTarget === 'year') {
      return years.map((y) => ({
        key: String(y),
        label: String(y),
        selected: selectedYear === y,
        onSelect: () => {
          setSelectedYear(y);
          setDropdownTarget(null);
        },
      }));
    }
    return [];
  }, [dropdownTarget, selectedMonth, selectedYear, years]);

  if (loadingVariables) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
      </ThemedView>
    );
  }

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
              Centro de reportería
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
              onPress={() => setDropdownTarget('month')}
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
              onPress={() => setDropdownTarget('year')}
            >
              <ThemedText style={[styles.dropdownText, { color: isDark ? '#fff' : '#111' }]}>
                {selectedYear}
              </ThemedText>
              <ThemedText style={styles.dropdownChevron}>▼</ThemedText>
            </Pressable>

            <ThemedText style={styles.sectionTitle}>Tipo de reporte</ThemedText>
            <View style={styles.reportTypeRow}>
              <Pressable
                style={[
                  styles.reportTypeOption,
                  { borderColor: tintColor },
                  reportType === 'preliminar' && { backgroundColor: tintColor + '30' },
                ]}
                onPress={() => setReportType('preliminar')}
              >
                <ThemedText
                  style={reportType === 'preliminar' ? styles.reportTypeTextActive : undefined}
                >
                  Reporte preliminar
                </ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.reportTypeOption,
                  { borderColor: tintColor },
                  reportType === 'final' && { backgroundColor: tintColor + '30' },
                ]}
                onPress={() => setReportType('final')}
              >
                <ThemedText style={reportType === 'final' ? styles.reportTypeTextActive : undefined}>
                  Reporte final
                </ThemedText>
              </Pressable>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </View>
            ) : null}

            <GesturePressable
              style={[styles.primaryButton, { backgroundColor: tintColor, opacity: loading ? 0.7 : 1 }]}
              onPress={handleSubmit}
              disabled={loading || sendingEmail}
            >
              {loading ? (
                <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
              ) : (
                <ThemedText style={[styles.primaryButtonText, { color: isDark ? '#111' : '#fff' }]}>
                  Consultar histórico
                </ThemedText>
              )}
            </GesturePressable>

            <GesturePressable
              style={[
                styles.secondaryButton,
                { borderColor: tintColor, opacity: sendingEmail ? 0.7 : 1 },
              ]}
              onPress={handleSendEmail}
              disabled={loading || sendingEmail}
            >
              {sendingEmail ? (
                <ActivityIndicator size="small" color={tintColor} />
              ) : (
                <ThemedText style={[styles.secondaryButtonText, { color: tintColor }]}>
                  Enviar por email
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
          visible={dropdownTarget !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setDropdownTarget(null)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setDropdownTarget(null)}>
            <View
              style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              onStartShouldSetResponder={() => true}
            >
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                {dropdownOptions.map((opt, index) => (
                  <Pressable
                    key={opt.key}
                    style={[
                      styles.dropdownOption,
                      index === dropdownOptions.length - 1 && styles.dropdownOptionLast,
                      opt.selected && { backgroundColor: tintColor + '30' },
                    ]}
                    onPress={opt.onSelect}
                  >
                    <ThemedText style={opt.selected ? styles.dropdownOptionTextActive : undefined}>
                      {opt.label}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
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
  reportTypeRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  reportTypeOption: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  reportTypeTextActive: {
    fontWeight: '600',
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
  secondaryButton: {
    height: 48,
    paddingHorizontal: 15,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 2,
  },
  secondaryButtonText: {
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
