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

const VARIABLES_DOC_PATH = ['variables', 'config'] as const;

function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const num = parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

export default function VariablesScreen() {
  const insets = useSafeAreaInsets();
  const [cuotaMantenimiento, setCuotaMantenimiento] = useState('');
  const [precioM3, setPrecioM3] = useState('');
  const [moneda, setMoneda] = useState('');
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
          setCuotaMantenimiento(String(data.cuotaMantenimiento));
        }
        if (typeof data.precioM3 === 'number') {
          setPrecioM3(String(data.precioM3));
        }
        if (typeof data.moneda === 'string') {
          setMoneda(data.moneda);
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
    const trimmedMoneda = moneda.trim();

    if (cuotaNum === null || cuotaNum < 0) {
      setError('La cuota de mantenimiento debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (precioNum === null || precioNum < 0) {
      setError('El precio por M³ debe ser un número decimal válido (≥ 0).');
      return;
    }
    if (!trimmedMoneda) {
      setError('La moneda es obligatoria (ej. $, Q, USD).');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await setDoc(
        doc(db, ...VARIABLES_DOC_PATH),
        {
          cuotaMantenimiento: cuotaNum,
          precioM3: precioNum,
          moneda: trimmedMoneda,
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
