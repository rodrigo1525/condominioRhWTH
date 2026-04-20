import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
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

/** Valida formato YYYY-MM */
function parsePeriod(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
  const [y, m] = trimmed.split('-').map(Number);
  if (m < 1 || m > 12) return null;
  return trimmed;
}

export default function ReadingEditScreen() {
  const insets = useSafeAreaInsets();
  const { id: readingId } = useLocalSearchParams<{ id: string }>();
  const [period, setPeriod] = useState('');
  const [value, setValue] = useState('');
  const [previousValue, setPreviousValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (!readingId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'readings', readingId));
        if (cancelled) return;
        if (snap.exists()) {
          const d = snap.data();
          setPeriod(d.period ?? '');
          setValue(typeof d.value === 'number' ? String(d.value) : '');
          setPreviousValue(
            d.previousValue != null ? String(d.previousValue) : ''
          );
        }
      } catch {
        if (!cancelled) setError('Error al cargar la lectura.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readingId]);

  const handleSave = async () => {
    const periodNorm = parsePeriod(period);
    if (!periodNorm) {
      setError('Período debe ser AAAA-MM (ej: 2025-01).');
      return;
    }
    const valueNum = parseFloat(value.replace(',', '.'));
    if (Number.isNaN(valueNum) || valueNum < 0) {
      setError('La lectura debe ser un número válido mayor o igual a 0.');
      return;
    }
    const prevNum =
      previousValue.trim() === ''
        ? null
        : parseFloat(previousValue.replace(',', '.'));
    if (
      previousValue.trim() !== '' &&
      (Number.isNaN(prevNum!) || prevNum! < 0)
    ) {
      setError('La lectura anterior debe ser un número válido o estar vacía.');
      return;
    }

    const consumption =
      prevNum != null
        ? Math.round((valueNum - prevNum) * 100) / 100
        : null;

    setError(null);
    setSaving(true);
    try {
      await updateDoc(doc(db, 'readings', readingId!), {
        period: periodNorm,
        value: valueNum,
        previousValue: prevNum ?? null,
        consumption,
      });
      Alert.alert('Éxito', 'Lectura actualizada correctamente.', [
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

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.keyboardView, { paddingBottom: insets.bottom }]}
      >
        <ThemedText type="title" style={styles.title}>
          Editar lectura
        </ThemedText>

        {error ? (
          <View style={styles.errorBox}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        <ThemedText style={styles.label}>Período (AAAA-MM)</ThemedText>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0',
              color: isDark ? '#fff' : '#111',
            },
          ]}
          placeholder="2025-01"
          placeholderTextColor={isDark ? '#888' : '#666'}
          value={period}
          onChangeText={setPeriod}
          editable={!saving}
          autoCapitalize="none"
        />

        <ThemedText style={styles.label}>Lectura actual</ThemedText>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0',
              color: isDark ? '#fff' : '#111',
            },
          ]}
          placeholder="Ej: 1234.56"
          placeholderTextColor={isDark ? '#888' : '#666'}
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          editable={!saving}
        />

        <ThemedText style={styles.label}>Lectura anterior (opcional)</ThemedText>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0',
              color: isDark ? '#fff' : '#111',
            },
          ]}
          placeholder="Vacío si es la primera"
          placeholderTextColor={isDark ? '#888' : '#666'}
          value={previousValue}
          onChangeText={setPreviousValue}
          keyboardType="decimal-pad"
          editable={!saving}
        />

        <GesturePressable
          style={[styles.button, { backgroundColor: tintColor }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
          ) : (
            <ThemedText
              style={[styles.buttonText, { color: isDark ? '#111' : '#fff' }]}
            >
              Guardar
            </ThemedText>
          )}
        </GesturePressable>

        <GesturePressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={[styles.backLinkText, { color: tintColor }]}>
            Cancelar
          </ThemedText>
        </GesturePressable>
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
  title: {
    marginBottom: 24,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    opacity: 0.9,
    marginBottom: 8,
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
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    fontSize: 16,
  },
  button: {
    height: 48,
    paddingHorizontal: 15,
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
