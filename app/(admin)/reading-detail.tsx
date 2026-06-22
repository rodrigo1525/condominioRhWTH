import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
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
import { db, functions } from '@/lib/firebase';

function getSendEmailErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code);
    const message =
      typeof (err as { message?: string }).message === 'string'
        ? (err as { message: string }).message
        : '';
    if (code === 'functions/not-found' || message.toLowerCase().includes('not found')) {
      return (
        'La función sendReadingByEmail no está desplegada. En la raíz del proyecto ejecuta ' +
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

/** Dado un periodo YYYY-MM devuelve el anterior (ej: 2025-01 → 2024-12). */
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

export default function ReadingDetailScreen() {
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
  const [emailToSend, setEmailToSend] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

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
      setEmailToSend(typeof houseData?.email === 'string' ? houseData.email.trim() : '');

      const prevP = prevPeriod(p);
      const prevQuery = query(
        collection(db, 'readings'),
        where('houseId', '==', houseId),
        where('period', '==', prevP)
      );
      const prevSnap = await getDocs(prevQuery);
      const prevDoc = prevSnap.docs[0];
      if (prevDoc) {
        const prevPhoto = prevDoc.data().photoUrl ?? null;
        setPrevPhotoUrl(prevPhoto);
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

  const handleSendEmail = useCallback(async () => {
    const toEmail = emailToSend.trim();
    if (!toEmail) {
      setEmailError('Indica el correo de destino.');
      return;
    }
    if (!photoUrl) {
      setEmailError('Esta lectura no tiene foto para enviar por correo.');
      return;
    }
    setEmailError(null);
    setSendingEmail(true);
    try {
      const sendFn = httpsCallable<
        {
          toEmail: string;
          photoUrl: string;
          casaNo: string;
          mes: string;
          lecturaMesAnterior: string | number;
          lecturaMesRegistrado: string | number;
          consumo: string | number | null;
        },
        { success: boolean; message?: string }
      >(functions, 'sendReadingByEmail');
      await sendFn({
        toEmail,
        photoUrl,
        casaNo: houseLabel || '—',
        mes: period ? formatPeriod(period) : '—',
        lecturaMesAnterior: previousValue != null ? previousValue : '—',
        lecturaMesRegistrado: value != null ? value : '—',
        consumo: consumption,
      });
      setEmailError(null);
      Alert.alert('Enviado', 'Correo enviado correctamente.');
    } catch (err: unknown) {
      setEmailError(getSendEmailErrorMessage(err));
    } finally {
      setSendingEmail(false);
    }
  }, [emailToSend, photoUrl, houseLabel, period, previousValue, value, consumption]);

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
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="title" style={styles.title}>
          Detalle de lectura
        </ThemedText>
        <ThemedText style={styles.periodTitle}>{period ? formatPeriod(period) : '—'}</ThemedText>

        {/* Resumen: CASA, LECTURA MES ANTERIOR, LECTURA MES SELECCIONADO, LO CONSUMIDO */}
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

        {/* Imágenes: mes anterior y mes del cálculo */}
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

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ThemedText style={styles.sectionLabel}>Enviar resumen por correo</ThemedText>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
            ]}
            placeholder="correo@ejemplo.com"
            placeholderTextColor={isDark ? '#888' : '#666'}
            value={emailToSend}
            onChangeText={setEmailToSend}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!sendingEmail}
          />
          <GesturePressable
            style={[styles.secondaryButton, { borderColor: tintColor }]}
            onPress={handleSendEmail}
            disabled={sendingEmail || !photoUrl}
          >
            {sendingEmail ? (
              <ActivityIndicator size="small" color={tintColor} />
            ) : (
              <ThemedText style={[styles.secondaryButtonText, { color: tintColor }]}>
                Enviar por correo (foto + tabla)
              </ThemedText>
            )}
          </GesturePressable>
          {!photoUrl ? (
            <ThemedText style={styles.emailHint}>
              Esta lectura no tiene foto; no se puede enviar por correo.
            </ThemedText>
          ) : null}
          {emailError ? (
            <View style={styles.errorBox}>
              <ThemedText style={styles.errorText}>{emailError}</ThemedText>
            </View>
          ) : null}
        </KeyboardAvoidingView>

        <View style={styles.actions}>
          <GesturePressable
            style={[styles.primaryButton, { backgroundColor: tintColor }]}
            onPress={() => router.push(`/(admin)/reading-edit?id=${readingId}` as const)}
          >
            <ThemedText style={[styles.primaryButtonText, { color: isDark ? '#111' : '#fff' }]}>
              Editar lectura
            </ThemedText>
          </GesturePressable>
          <GesturePressable style={styles.backLink} onPress={() => router.back()}>
            <ThemedText style={[styles.backLinkText, { color: tintColor }]}>
              Volver
            </ThemedText>
          </GesturePressable>
        </View>
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
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
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
  emailHint: {
    fontSize: 13,
    opacity: 0.7,
    marginTop: 8,
    textAlign: 'center',
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(220, 53, 69, 0.15)',
    marginTop: 12,
  },
  actions: {
    gap: 12,
    marginTop: 24,
  },
  primaryButton: {
    height: 48,
    paddingHorizontal: 15,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
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
  errorText: {
    color: '#dc3545',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
});
