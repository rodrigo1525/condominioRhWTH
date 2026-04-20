import { addDoc, collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { db } from '@/lib/firebase';

interface UserOption {
  id: string;
  email: string | null;
}

export default function HouseEditScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const [address, setAddress] = useState('');
  const [meterNumber, setMeterNumber] = useState('');
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const snap = await getDocs(collection(db, 'user'));
      const list: UserOption[] = snap.docs
        .filter((d) => (d.data().role ?? 'user') === 'user')
        .map((d) => ({ id: d.id, email: d.data().email ?? null }))
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
      setUserOptions(list);
    } catch {
      setUserOptions([]);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'houses', id!));
        if (cancelled) return;
        if (snap.exists()) {
          const d = snap.data();
          setAddress(d.address ?? '');
          setMeterNumber(d.meterNumber ?? '');
          setAssignedUserId(d.userId ?? null);
        }
      } catch (err) {
        if (!cancelled) setError('Error al cargar la casa.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  const handleSave = async () => {
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setError('La dirección es obligatoria.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const data = {
        address: trimmedAddress,
        meterNumber: meterNumber.trim(),
        userId: assignedUserId || null,
      };
      if (isEdit) {
        await setDoc(doc(db, 'houses', id!), data, { merge: true });
      } else {
        await addDoc(collection(db, 'houses'), data);
      }
      Alert.alert(
        'Éxito',
        isEdit ? 'Casa actualizada correctamente.' : 'Casa creada correctamente.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err) {
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
          {isEdit ? 'Editar casa' : 'Nueva casa'}
        </ThemedText>

        {error ? (
          <View style={styles.errorBox}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        <TextInput
          style={[
            styles.input,
            { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
          ]}
          placeholder="Dirección"
          placeholderTextColor={isDark ? '#888' : '#666'}
          value={address}
          onChangeText={setAddress}
          editable={!saving}
        />

        <TextInput
          style={[
            styles.input,
            { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
          ]}
          placeholder="Número de medidor"
          placeholderTextColor={isDark ? '#888' : '#666'}
          value={meterNumber}
          onChangeText={setMeterNumber}
          editable={!saving}
        />

        <ThemedText style={styles.label}>Usuario asignado (ve su consumo)</ThemedText>
        {loadingUsers ? (
          <View style={[styles.dropdown, styles.dropdownDisabled, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', borderColor: tintColor }]}>
            <ActivityIndicator size="small" color={tintColor} />
            <ThemedText style={[styles.dropdownText, { color: isDark ? '#888' : '#666' }]}>Cargando usuarios...</ThemedText>
          </View>
        ) : (
          <>
            <Pressable
              style={[
                styles.dropdown,
                { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', borderColor: tintColor },
              ]}
              onPress={() => setUserDropdownOpen(true)}
              disabled={saving}
            >
              <ThemedText style={[styles.dropdownText, { color: isDark ? '#fff' : '#111' }]} numberOfLines={1}>
                {assignedUserId === null
                  ? 'Ninguno'
                  : userOptions.find((u) => u.id === assignedUserId)?.email ?? assignedUserId}
              </ThemedText>
              <ThemedText style={styles.dropdownChevron}>▼</ThemedText>
            </Pressable>
            <Modal
              visible={userDropdownOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setUserDropdownOpen(false)}
            >
              <Pressable style={styles.modalOverlay} onPress={() => setUserDropdownOpen(false)}>
                <View
                  style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                  onStartShouldSetResponder={() => true}
                >
                  <ScrollView
                    style={styles.modalScroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={true}
                  >
                    <Pressable
                      style={[styles.dropdownOption, assignedUserId === null && { backgroundColor: tintColor + '30' }]}
                      onPress={() => {
                        setAssignedUserId(null);
                        setUserDropdownOpen(false);
                      }}
                    >
                      <ThemedText style={assignedUserId === null ? styles.dropdownOptionTextActive : undefined}>
                        Ninguno
                      </ThemedText>
                    </Pressable>
                    {userOptions.map((u, index) => (
                      <Pressable
                        key={u.id}
                        style={[
                          styles.dropdownOption,
                          index === userOptions.length - 1 && styles.dropdownOptionLast,
                          assignedUserId === u.id && { backgroundColor: tintColor + '30' },
                        ]}
                        onPress={() => {
                          setAssignedUserId(u.id);
                          setUserDropdownOpen(false);
                        }}
                      >
                        <ThemedText
                          style={assignedUserId === u.id ? styles.dropdownOptionTextActive : undefined}
                          numberOfLines={1}
                        >
                          {u.email ?? u.id}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </Pressable>
            </Modal>
          </>
        )}

        <GesturePressable
          style={[styles.button, { backgroundColor: tintColor }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
          ) : (
            <ThemedText style={[styles.buttonText, { color: isDark ? '#111' : '#fff' }]}>
              {isEdit ? 'Guardar' : 'Crear casa'}
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
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
  dropdownDisabled: {
    opacity: 0.8,
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
  title: {
    marginBottom: 24,
    textAlign: 'center',
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