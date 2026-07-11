import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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

function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const num = parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

function parseOptionalDecimal(value: string): number {
  return parseDecimal(value) ?? 0;
}

function parseDateISO(str: string): boolean {
  const trimmed = str.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10) - 1;
  const d = parseInt(match[3], 10);
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d;
}

export default function PagoEditScreen() {
  const insets = useSafeAreaInsets();
  const { id: pagoId } = useLocalSearchParams<{ id: string }>();
  const [fechaPago, setFechaPago] = useState('');
  const [readingPeriod, setReadingPeriod] = useState<string | null>(null);
  const [saldoAnterior, setSaldoAnterior] = useState<number | null>(null);
  const [periodoSaldoAnterior, setPeriodoSaldoAnterior] = useState<string | null>(null);
  const [mora, setMora] = useState('');
  const [consumo, setConsumo] = useState('');
  const [cuotaMantenimiento, setCuotaMantenimiento] = useState('');
  const [otros, setOtros] = useState('');
  const [ajustes, setAjustes] = useState('');
  const [pago, setPago] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (!pagoId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'pagos', pagoId));
        if (cancelled) return;
        if (snap.exists()) {
          const d = snap.data();
          setFechaPago(d.fechaPago ?? '');
          setReadingPeriod(typeof d.period === 'string' ? d.period : null);
          setSaldoAnterior(typeof d.saldoAnterior === 'number' ? parseMoneyField(d.saldoAnterior) : null);
          setPeriodoSaldoAnterior(
            typeof d.periodoSaldoAnterior === 'string' ? d.periodoSaldoAnterior : null
          );
          setMora(typeof d.mora === 'number' ? formatMoneyInput(d.mora) : '');
          setConsumo(typeof d.consumo === 'number' ? formatMoneyInput(d.consumo) : '');
          setCuotaMantenimiento(
            typeof d.cuotaMantenimiento === 'number' ? formatMoneyInput(d.cuotaMantenimiento) : ''
          );
          setOtros(typeof d.otros === 'number' ? formatMoneyInput(d.otros) : '');
          setAjustes(typeof d.ajustes === 'number' ? formatMoneyInput(d.ajustes) : '');
          setPago(typeof d.pago === 'number' ? formatMoneyInput(d.pago) : '');
        }
      } catch {
        if (!cancelled) setError('Error al cargar el pago.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pagoId]);

  const saldoAnteriorAmount = saldoAnterior != null ? roundMoney(saldoAnterior) : undefined;

  const moneyFields = useMemo(
    () =>
      toPagoMoneyFields({
        mora: parseDecimal(mora) ?? 0,
        consumo: parseDecimal(consumo) ?? 0,
        cuotaMantenimiento: parseDecimal(cuotaMantenimiento) ?? 0,
        otros: parseOptionalDecimal(otros),
        ajustes: parseOptionalDecimal(ajustes),
        pago: parseDecimal(pago) ?? 0,
        saldoAnterior: saldoAnterior != null ? saldoAnteriorAmount : undefined,
        mergeSaldoIntoConsumo: false,
      }),
    [mora, consumo, cuotaMantenimiento, otros, ajustes, pago, saldoAnterior, saldoAnteriorAmount]
  );

  const { total, diferencia } = moneyFields;

  const handleSave = async () => {
    if (!parseDateISO(fechaPago)) {
      setError('La fecha del pago debe tener formato AAAA-MM-DD.');
      return;
    }
    const moraValue = parseDecimal(mora);
    const consumoValue = parseDecimal(consumo);
    const cuotaValue = parseDecimal(cuotaMantenimiento);
    const pagoValue = parseDecimal(pago);

    if (moraValue === null || moraValue < 0) {
      setError('La mora debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (consumoValue === null || consumoValue < 0) {
      setError('El consumo debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (cuotaValue === null || cuotaValue < 0) {
      setError('La cuota de mantenimiento debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (pagoValue === null || pagoValue < 0) {
      setError('El pago debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (otros.trim() && parseDecimal(otros) === null) {
      setError('Otro debe ser un número decimal válido.');
      return;
    }
    if (ajustes.trim() && parseDecimal(ajustes) === null) {
      setError('Ajuste JD debe ser un número decimal válido.');
      return;
    }

    const otrosValue = parseOptionalDecimal(otros);
    const ajustesValue = parseOptionalDecimal(ajustes);

    const moneyFieldsToSave = toPagoMoneyFields({
      mora: moraValue,
      consumo: consumoValue,
      cuotaMantenimiento: cuotaValue,
      otros: otrosValue,
      ajustes: ajustesValue,
      pago: pagoValue,
      saldoAnterior: saldoAnteriorAmount,
      mergeSaldoIntoConsumo: false,
    });

    if (moneyFieldsToSave.total !== total) {
      setError(
        `El total a guardar (${formatMoneyInput(moneyFieldsToSave.total)}) no coincide con el mostrado (${formatMoneyInput(total)}). Revisa los montos.`
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
      await updateDoc(doc(db, 'pagos', pagoId!), {
        fechaPago: fechaPago.trim(),
        ...toFirestorePagoMoney(moneyFieldsToSave),
      });
      Alert.alert('Éxito', 'Pago actualizado correctamente.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      setError('Error al guardar. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
        <ThemedText style={styles.loadingText}>Cargando...</ThemedText>
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
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + insets.bottom }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ThemedText type="title" style={styles.title}>
              Editar pago
            </ThemedText>

            {error ? (
              <View style={styles.errorBox}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </View>
            ) : null}

            {saldoAnterior != null && saldoAnterior !== 0 ? (
              <>
                <ThemedText style={styles.label}>Saldo anterior</ThemedText>
                <TextInput
                  style={readOnlyStyle}
                  value={
                    saldoAnterior < 0
                      ? `(${Math.abs(saldoAnterior).toFixed(2)})`
                      : saldoAnterior.toFixed(2)
                  }
                  editable={false}
                />
                {periodoSaldoAnterior ? (
                  <ThemedText style={styles.hint}>
                    Diferencia del pago de {periodoSaldoAnterior}
                  </ThemedText>
                ) : null}
              </>
            ) : null}

            {readingPeriod ? (
              <>
                <ThemedText style={styles.label}>Período de lectura</ThemedText>
                <TextInput style={readOnlyStyle} value={readingPeriod} editable={false} />
              </>
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
              value={mora}
              onChangeText={setMora}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Consumo</ThemedText>
            <TextInput
              style={inputStyle}
              value={consumo}
              onChangeText={setConsumo}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Cuota mantenimiento</ThemedText>
            <TextInput
              style={inputStyle}
              value={cuotaMantenimiento}
              onChangeText={setCuotaMantenimiento}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Otro</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="0.00"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={otros}
              onChangeText={setOtros}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Ajuste JD</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="0.00"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={ajustes}
              onChangeText={setAjustes}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Total</ThemedText>
            <TextInput style={readOnlyStyle} value={formatMoneyInput(total)} editable={false} />
            <ThemedText style={styles.hint}>
              Mora + consumo + mantenimiento + otro + ajuste JD + saldo anterior
            </ThemedText>

            <ThemedText style={styles.label}>Pago</ThemedText>
            <TextInput
              style={inputStyle}
              value={pago}
              onChangeText={setPago}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Diferencia</ThemedText>
            <TextInput style={readOnlyStyle} value={formatMoneyInput(diferencia)} editable={false} />
            <ThemedText style={styles.hint}>Total − pago</ThemedText>

            <GesturePressable
              style={[styles.button, { backgroundColor: tintColor }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
              ) : (
                <ThemedText style={[styles.buttonText, { color: isDark ? '#111' : '#fff' }]}>
                  Guardar
                </ThemedText>
              )}
            </GesturePressable>

            <GesturePressable style={styles.backLink} onPress={() => router.back()}>
              <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Cancelar</ThemedText>
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
    gap: 16,
  },
  loadingText: {
    opacity: 0.8,
  },
  keyboardView: {
    flex: 1,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  title: {
    marginBottom: 24,
    textAlign: 'center',
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
  errorBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(220, 53, 69, 0.15)',
    marginBottom: 16,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 14,
    textAlign: 'center',
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
    marginTop: 24,
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
