import { doc, getDoc, setDoc } from 'firebase/firestore';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { formatMoneyInput, roundMoney } from '@/lib/money-utils';

const VARIABLES_DOC_PATH = ['variables', 'config'] as const;

function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const num = parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

function parseDay(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = parseInt(trimmed, 10);
  if (!Number.isFinite(num) || num <= 0 || num > 30) return null;
  return num;
}

export default function VariablesScreen() {
  const insets = useSafeAreaInsets();
  const [cuotaMantenimiento, setCuotaMantenimiento] = useState('');
  const [precioM3, setPrecioM3] = useState('');
  const [precioMora, setPrecioMora] = useState('');
  const [moneda, setMoneda] = useState('');
  const [diaCorte, setDiaCorte] = useState('');
  const [diaCorteAdicional, setDiaCorteAdicional] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const loadVariables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDoc(doc(db, ...VARIABLES_DOC_PATH));
      if (snap.exists()) {
        const data = snap.data();
        if (typeof data.cuotaMantenimiento === 'number') {
          setCuotaMantenimiento(formatMoneyInput(data.cuotaMantenimiento));
        }
        if (typeof data.precioM3 === 'number') {
          setPrecioM3(formatMoneyInput(data.precioM3));
        }
        if (typeof data.precioMora === 'number') {
          setPrecioMora(formatMoneyInput(data.precioMora));
        }
        if (typeof data.moneda === 'string') {
          setMoneda(data.moneda);
        }
        if (typeof data.diaCorte === 'number') {
          setDiaCorte(String(data.diaCorte));
        }
        if (typeof data.diaCorteAdicional === 'number') {
          setDiaCorteAdicional(String(data.diaCorteAdicional));
        }
      }
    } catch {
      setError('Error al cargar las variables.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVariables();
  }, [loadVariables]);

  const handleSave = async () => {
    const cuotaNum = parseDecimal(cuotaMantenimiento);
    const precioNum = parseDecimal(precioM3);
    const precioMoraNum = parseDecimal(precioMora);
    const diaCorteNum = parseDay(diaCorte);
    const diaCorteAdicionalNum = parseDay(diaCorteAdicional);
    const trimmedMoneda = moneda.trim();

    if (cuotaNum === null || cuotaNum < 0) {
      setError('La cuota de mantenimiento debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (precioNum === null || precioNum < 0) {
      setError('El precio por M³ debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (precioMoraNum === null || precioMoraNum < 0) {
      setError('El precio mora debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (!trimmedMoneda) {
      setError('La moneda es obligatoria (ej. $, Q, USD).');
      return;
    }
    if (diaCorteNum === null) {
      setError('El día corte debe ser un número entero mayor que 0 y menor o igual a 30.');
      return;
    }
    if (diaCorteAdicionalNum === null) {
      setError('El día corte adicional debe ser un número entero mayor que 0 y menor o igual a 30.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await setDoc(
        doc(db, ...VARIABLES_DOC_PATH),
        {
          cuotaMantenimiento: roundMoney(cuotaNum),
          precioM3: roundMoney(precioNum),
          precioMora: roundMoney(precioMoraNum),
          moneda: trimmedMoneda,
          diaCorte: diaCorteNum,
          diaCorteAdicional: diaCorteAdicionalNum,
        },
        { merge: true }
      );
      Alert.alert('Éxito', 'Variables guardadas correctamente.');
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
      </ThemedView>
    );
  }

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
              Variables
            </ThemedText>
            <ThemedText style={styles.subtitle}>
              Configuración única del condominio.
            </ThemedText>

            {error ? (
              <View style={styles.errorBox}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </View>
            ) : null}

            <ThemedText style={styles.label}>Cuota mantenimiento</ThemedText>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
              ]}
              placeholder="Ej: 150.00"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={cuotaMantenimiento}
              onChangeText={setCuotaMantenimiento}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Precio M³</ThemedText>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
              ]}
              placeholder="Ej: 12.50"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={precioM3}
              onChangeText={setPrecioM3}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Precio mora</ThemedText>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
              ]}
              placeholder="Ej: 25.00"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={precioMora}
              onChangeText={setPrecioMora}
              keyboardType="decimal-pad"
              editable={!saving}
            />

            <ThemedText style={styles.label}>Moneda</ThemedText>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
              ]}
              placeholder="Ej: $, Q, USD"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={moneda}
              onChangeText={setMoneda}
              editable={!saving}
              maxLength={10}
            />

            <ThemedText style={styles.label}>Día corte</ThemedText>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
              ]}
              placeholder="Ej: 15"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={diaCorte}
              onChangeText={setDiaCorte}
              keyboardType="number-pad"
              editable={!saving}
              maxLength={2}
            />

            <ThemedText style={styles.label}>Día corte adicional</ThemedText>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
              ]}
              placeholder="Ej: 15"
              placeholderTextColor={isDark ? '#888' : '#666'}
              value={diaCorteAdicional}
              onChangeText={setDiaCorteAdicional}
              keyboardType="number-pad"
              editable={!saving}
              maxLength={2}
            />

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
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
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
});
