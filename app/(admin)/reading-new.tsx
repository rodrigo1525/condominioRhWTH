import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { addDoc, collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useAuth } from '@/context/auth-context';
import { db, functions, storage } from '@/lib/firebase';

interface HouseItem {
  id: string;
  address: string;
  meterNumber: string;
  userId?: string | null;
}

/** Extrae un número (entero o decimal) del texto OCR para sugerir como lectura. */
function parseReadingFromOcr(text: string): string {
  if (!text || !text.trim()) return '';
  const cleaned = text.replace(/,/g, '.').replace(/\s/g, '');
  const match = cleaned.match(/\d+(\.\d+)?/);
  return match ? match[0] : text.trim().slice(0, 20);
}

export default function ReadingNewScreen() {
  const insets = useSafeAreaInsets();
  const { houseId: paramHouseId } = useLocalSearchParams<{ houseId?: string }>();
  const { profile } = useAuth();
  const [houses, setHouses] = useState<HouseItem[]>([]);
  const [loadingHouses, setLoadingHouses] = useState(true);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(paramHouseId ?? null);
  const [houseDropdownOpen, setHouseDropdownOpen] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [readingValue, setReadingValue] = useState('');
  const [previousValue, setPreviousValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [emailToSend, setEmailToSend] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const loadHouses = useCallback(async () => {
    setLoadingHouses(true);
    try {
      const snap = await getDocs(collection(db, 'houses'));
      const list: HouseItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          address: data.address ?? '',
          meterNumber: data.meterNumber ?? '',
          userId: data.userId ?? null,
        };
      });
      setHouses(list.sort((a, b) => a.address.localeCompare(b.address)));
      if (paramHouseId && list.some((h) => h.id === paramHouseId)) {
        setSelectedHouseId(paramHouseId);
      } else if (list.length === 1 && !selectedHouseId) {
        setSelectedHouseId(list[0].id);
      }
    } catch (err) {
      console.error(err);
      setError('Error al cargar casas.');
    } finally {
      setLoadingHouses(false);
    }
  }, [selectedHouseId, paramHouseId]);

  useEffect(() => {
    loadHouses();
  }, [loadHouses]);

  // Al cambiar de casa, limpiar imagen y lectura actual para que "lectura actual"
  // provenga siempre de la imagen tomada para esta casa (evitar mezclar con casa anterior).
  useEffect(() => {
    if (!selectedHouseId) return;
    setImageUri(null);
    setOcrText('');
    setPhotoUrl(null);
    setReadingValue('');
    // previousValue se recargará en el otro useEffect según la casa seleccionada
  }, [selectedHouseId]);

  // Cargar última lectura de la casa seleccionada para sugerir previousValue (periodo anterior al actual)
  useEffect(() => {
    if (!selectedHouseId) return;
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const q = query(
          collection(db, 'readings'),
          where('houseId', '==', selectedHouseId),
          where('period', '<', currentPeriod),
          orderBy('period', 'desc')
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const first = snap.docs[0];
        if (first) {
          const val = first.data().value;
          if (typeof val === 'number') setPreviousValue(String(val));
        }
      } catch {
        // Índice compuesto (houseId, period) puede ser necesario; ver consola Firebase.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedHouseId]);

  const pickImage = useCallback(async (useCamera: boolean) => {
    setError(null);
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(useCamera ? 'Se necesita permiso de cámara.' : 'Se necesita permiso para acceder a fotos.');
      return;
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.8,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.8,
        });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setOcrText('');
      setPhotoUrl(null);
    }
  }, []);

  const uploadAndRunOcr = useCallback(async () => {
    if (!imageUri || !profile?.uid) return;
    setError(null);
    setUploading(true);
    setOcrRunning(true);
    try {
      const response = await fetch(imageUri);
      const blob = await response.blob();
      const filename = `readings/${profile.uid}/${Date.now()}.jpg`;
      const storageRef = ref(storage, filename);
      await uploadBytes(storageRef, blob);
      const url = await getDownloadURL(storageRef);
      setPhotoUrl(url);

      const ocrFn = httpsCallable<{ imageUrl: string }, { text: string; rawContent?: string }>(
        functions,
        'ocrReadFromUrl'
      );
      const { data } = await ocrFn({ imageUrl: url });
      const text = data?.text ?? '';
      setOcrText(text);
      const suggested = parseReadingFromOcr(text);
      // Siempre asignar el resultado del OCR a LECTURA ACTUAL (nunca a lectura anterior).
      if (suggested) setReadingValue(suggested);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('OCR no configurado')
        ? 'Configura AZURE_OCR_ENDPOINT y AZURE_OCR_KEY en las Cloud Functions.'
        : msg);
    } finally {
      setUploading(false);
      setOcrRunning(false);
    }
  }, [imageUri, profile?.uid]);

  const handleSave = useCallback(async () => {
    const houseId = selectedHouseId;
    const house = houses.find((h) => h.id === houseId);
    if (!houseId) {
      setError('Elige una casa.');
      return;
    }
    const valueNum = parseFloat(readingValue.replace(',', '.'));
    if (Number.isNaN(valueNum) || valueNum < 0) {
      setError('La lectura debe ser un número válido.');
      return;
    }
    const prevNum = previousValue.trim() === '' ? null : parseFloat(previousValue.replace(',', '.'));
    if (previousValue.trim() !== '' && (Number.isNaN(prevNum!) || prevNum! < 0)) {
      setError('La lectura anterior debe ser un número válido o estar vacía.');
      return;
    }
    if (!photoUrl) {
      setError('Sube una foto y ejecuta OCR antes de guardar.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const consumption = prevNum != null ? valueNum - prevNum : null;
      await addDoc(collection(db, 'readings'), {
        houseId,
        userId: house?.userId ?? null,
        period,
        value: valueNum,
        previousValue: prevNum ?? null,
        consumption: consumption != null ? Math.round(consumption * 100) / 100 : null,
        photoUrl,
        ocrRaw: ocrText || null,
        createdAt: new Date(),
        createdBy: profile?.uid ?? null,
      });
      Alert.alert('Éxito', 'Lectura registrada correctamente.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }, [selectedHouseId, houses, readingValue, previousValue, photoUrl, ocrText, profile?.uid]);

  const handleSendEmail = useCallback(async () => {
    const house = houses.find((h) => h.id === selectedHouseId);
    const toEmail = emailToSend.trim();
    if (!toEmail) {
      setError('Indica el correo de destino.');
      return;
    }
    if (!photoUrl) {
      setError('Sube una foto y ejecuta OCR antes de enviar por correo.');
      return;
    }
    const prevNum = previousValue.trim() === '' ? null : parseFloat(previousValue.replace(',', '.'));
    const valueNum = parseFloat(readingValue.replace(',', '.'));
    const consumption =
      !Number.isNaN(valueNum) && prevNum != null && !Number.isNaN(prevNum)
        ? valueNum - prevNum
        : null;
    setError(null);
    setSendingEmail(true);
    try {
      const sendFn = httpsCallable<
        {
          toEmail: string;
          photoUrl: string;
          casaNo: string;
          lecturaMesAnterior: string | number;
          lecturaMesRegistrado: string | number;
          consumo: string | number | null;
        },
        { success: boolean; message?: string }
      >(functions, 'sendReadingByEmail');
      await sendFn({
        toEmail,
        photoUrl,
        casaNo: house?.address || house?.meterNumber || house?.id || '—',
        lecturaMesAnterior: previousValue.trim() === '' ? '—' : previousValue,
        lecturaMesRegistrado: readingValue,
        consumo: consumption != null ? consumption : null,
      });
      setEmailToSend('');
      setError(null);
      // Opcional: mostrar éxito (podrías usar un toast)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al enviar el correo.');
    } finally {
      setSendingEmail(false);
    }
  }, [selectedHouseId, houses, emailToSend, photoUrl, previousValue, readingValue]);

  const prevNum = previousValue.trim() === '' ? null : parseFloat(previousValue.replace(',', '.'));
  const valueNum = parseFloat(readingValue.replace(',', '.'));
  const consumption =
    !Number.isNaN(valueNum) && prevNum != null && !Number.isNaN(prevNum)
      ? valueNum - prevNum
      : null;

  if (loadingHouses) {
    return (
      <ThemedView style={styles.center}>
        <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
          <ActivityIndicator size="large" color={tintColor} />
          <ThemedText style={styles.loadingText}>Cargando casas...</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 48 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <ThemedText type="title" style={styles.title}>
            Registrar lectura
          </ThemedText>

          <ThemedText style={styles.label}>Casa</ThemedText>
          <Pressable
            style={[
              styles.houseDropdown,
              { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', borderColor: tintColor },
            ]}
            onPress={() => houses.length > 0 && setHouseDropdownOpen(true)}
            disabled={houses.length === 0}
          >
            <ThemedText
              style={[styles.houseDropdownText, { color: isDark ? '#fff' : '#111' }]}
              numberOfLines={1}
            >
              {selectedHouseId
                ? houses.find((h) => h.id === selectedHouseId)?.address ||
                  houses.find((h) => h.id === selectedHouseId)?.meterNumber ||
                  selectedHouseId
                : 'Seleccionar casa...'}
            </ThemedText>
            <ThemedText style={styles.houseDropdownChevron}>▼</ThemedText>
          </Pressable>
          {houses.length === 0 && (
            <ThemedText style={styles.hint}>No hay casas. Crea una en Gestionar casas.</ThemedText>
          )}
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
                <ScrollView
                  style={styles.modalScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={true}
                >
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

          <ThemedText style={styles.label}>Foto del medidor</ThemedText>
          <View style={styles.photoRow}>
            <GesturePressable
              style={[styles.photoButton, { borderColor: tintColor }]}
              onPress={() => pickImage(true)}
            >
              <ThemedText style={[styles.photoButtonText, { color: tintColor }]}>Cámara</ThemedText>
            </GesturePressable>
            <GesturePressable
              style={[styles.photoButton, { borderColor: tintColor }]}
              onPress={() => pickImage(false)}
            >
              <ThemedText style={[styles.photoButtonText, { color: tintColor }]}>Galería</ThemedText>
            </GesturePressable>
          </View>

          {imageUri ? (
            <>
              <View style={styles.previewContainer}>
                <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />
              </View>
              {!photoUrl ? (
                <GesturePressable
                  style={[styles.primaryButton, { backgroundColor: tintColor }]}
                  onPress={uploadAndRunOcr}
                  disabled={uploading || ocrRunning}
                >
                  {uploading || ocrRunning ? (
                    <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
                  ) : (
                    <ThemedText style={[styles.primaryButtonText, { color: isDark ? '#111' : '#fff' }]}>
                      Subir y leer con OCR
                    </ThemedText>
                  )}
                </GesturePressable>
              ) : null}
            </>
          ) : null}

          {ocrText ? (
            <ThemedText style={styles.ocrLabel}>Texto detectado (puedes editarlo abajo)</ThemedText>
          ) : null}

          <ThemedText style={styles.label}>Lectura actual (número)</ThemedText>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
            ]}
            placeholder="Ej. 12345"
            placeholderTextColor={isDark ? '#888' : '#666'}
            value={readingValue}
            onChangeText={setReadingValue}
            keyboardType="decimal-pad"
            editable={!saving}
          />

          <ThemedText style={styles.label}>Lectura anterior (opcional)</ThemedText>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
            ]}
            placeholder="Para calcular consumo"
            placeholderTextColor={isDark ? '#888' : '#666'}
            value={previousValue}
            onChangeText={setPreviousValue}
            keyboardType="decimal-pad"
            editable={!saving}
          />

          {consumption != null && !Number.isNaN(consumption) && (
            <ThemedText style={styles.consumption}>
              Consumo: {consumption.toFixed(2)}
            </ThemedText>
          )}

          {/*<ThemedText style={styles.label}>Enviar resumen por correo (opcional)</ThemedText>
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
          </GesturePressable>*/}

          {error ? (
            <View style={styles.errorBox}>
              <ThemedText style={styles.errorText}>{error}</ThemedText>
            </View>
          ) : null}

          <GesturePressable
            style={[styles.primaryButton, { backgroundColor: tintColor }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
            ) : (
              <ThemedText style={[styles.primaryButtonText, { color: isDark ? '#111' : '#fff' }]}>
                Guardar lectura
              </ThemedText>
            )}
          </GesturePressable>

          <GesturePressable style={styles.backLink} onPress={() => router.back()}>
            <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Cancelar</ThemedText>
          </GesturePressable>
        </KeyboardAvoidingView>
      </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
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
  keyboardView: {
    flex: 1,
  },
  title: {
    marginBottom: 20,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  hint: {
    fontSize: 13,
    opacity: 0.7,
    marginTop: 4,
  },
  houseDropdown: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    marginBottom: 4,
  },
  houseDropdownText: {
    fontSize: 16,
    flex: 1,
  },
  houseDropdownChevron: {
    fontSize: 12,
    opacity: 0.7,
    marginLeft: 8,
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
  photoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  photoButton: {
    height: 48,
    width: '50%',
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  previewContainer: {
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    minHeight: 180,
  },
  preview: {
    width: '100%',
    height: 220,
  },
  ocrLabel: {
    fontSize: 12,
    opacity: 0.8,
    marginTop: 16,
  },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  consumption: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
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
  backLink: {
    alignSelf: 'center',
    marginTop: 16,
    height: 48,
    paddingHorizontal: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backLinkText: {
    fontSize: 16,
  },
});
