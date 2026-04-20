import { Ionicons } from '@expo/vector-icons';
import { httpsCallable } from 'firebase/functions';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { functions } from '@/lib/firebase';

type Role = 'admin' | 'user';

/** Extrae mensaje amigable para errores de createUserAsAdmin (callable). */
function getCreateUserErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code);
    const message = typeof (err as { message?: string }).message === 'string'
      ? (err as { message: string }).message
      : '';
    if (code === 'functions/not-found' || message.toLowerCase().includes('not found')) {
      return (
        'La función no está disponible. Despliega las Cloud Functions: ' +
        'en la raíz del proyecto ejecuta "firebase deploy --only functions". ' +
        'Revisa también que EXPO_PUBLIC_FIREBASE_PROJECT_ID en .env coincida con tu proyecto Firebase.'
      );
    }
    if (code === 'functions/unauthenticated' || message.includes('iniciar sesión')) {
      return 'Debes iniciar sesión como administrador.';
    }
    if (code === 'functions/permission-denied') {
      return 'Solo un administrador puede crear usuarios.';
    }
    if (code === 'functions/already-exists' || message.includes('Ya existe')) {
      return message || 'Ya existe un usuario con ese correo.';
    }
    if (code === 'functions/invalid-argument') {
      return message || 'Datos inválidos. Revisa correo y contraseña.';
    }
    if (message) return message;
  }
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : '';
  return msg || 'Error al crear el usuario. Intenta de nuevo.';
}

export default function CreateUserScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const createUser = httpsCallable<
    { email: string; password: string; role: Role },
    { uid: string; email: string; role: Role }
  >(functions, 'createUserAsAdmin');

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError('Correo y contraseña son obligatorios.');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await createUser({ email: trimmed, password, role });
      setSuccess(true);
      setEmail('');
      setPassword('');
      Alert.alert('Éxito', 'Usuario creado correctamente.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      const msg = getCreateUserErrorMessage(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ThemedText type="title" style={styles.title}>
          Crear usuario
        </ThemedText>

        {error ? (
          <View style={styles.errorBox}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}
        {success ? (
          <View style={styles.successBox}>
            <ThemedText style={styles.successText}>Usuario creado correctamente.</ThemedText>
          </View>
        ) : null}

        <TextInput
          style={[
            styles.input,
            { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
          ]}
          placeholder="Correo electrónico"
          placeholderTextColor={isDark ? '#888' : '#666'}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!submitting}
        />

        <View style={styles.passwordRow}>
          <TextInput
            style={[
              styles.input,
              styles.passwordInput,
              { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', color: isDark ? '#fff' : '#111' },
            ]}
            placeholder="Contraseña (mín. 6 caracteres)"
            placeholderTextColor={isDark ? '#888' : '#666'}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="password-new"
            editable={!submitting}
          />
          <GesturePressable
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={12}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={isDark ? '#888' : '#666'}
            />
          </GesturePressable>
        </View>

        <View style={styles.roleRow}>
          <ThemedText style={styles.roleLabel}>Rol</ThemedText>
          <Pressable
            style={[
              styles.dropdown,
              { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0', borderColor: tintColor },
            ]}
            onPress={() => setRoleDropdownOpen(true)}
          >
            <ThemedText style={[styles.dropdownText, { color: isDark ? '#fff' : '#111' }]}>
              {role === 'user' ? 'Usuario' : 'Administrador'}
            </ThemedText>
            <Ionicons name="chevron-down" size={20} color={isDark ? '#888' : '#666'} />
          </Pressable>
        </View>
        <Modal
          visible={roleDropdownOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setRoleDropdownOpen(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setRoleDropdownOpen(false)}>
            <View
              style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              onStartShouldSetResponder={() => true}
            >
              <Pressable
                style={[styles.dropdownOption, role === 'user' && { backgroundColor: tintColor + '30' }]}
                onPress={() => {
                  setRole('user');
                  setRoleDropdownOpen(false);
                }}
              >
                <ThemedText style={role === 'user' ? styles.dropdownOptionTextActive : undefined}>
                  Usuario
                </ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.dropdownOption,
                  styles.dropdownOptionLast,
                  role === 'admin' && { backgroundColor: tintColor + '30' },
                ]}
                onPress={() => {
                  setRole('admin');
                  setRoleDropdownOpen(false);
                }}
              >
                <ThemedText style={role === 'admin' ? styles.dropdownOptionTextActive : undefined}>
                  Administrador
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        <GesturePressable
          style={[styles.button, { backgroundColor: tintColor }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
          ) : (
            <ThemedText style={[styles.buttonText, { color: isDark ? '#111' : '#fff' }]}>
              Crear usuario
            </ThemedText>
          )}
        </GesturePressable>

        <GesturePressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={[styles.backLinkText, { color: tintColor }]}>Volver al panel</ThemedText>
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
  successBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(40, 167, 69, 0.2)',
    marginBottom: 16,
  },
  successText: {
    color: '#28a745',
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
  passwordRow: {
    position: 'relative',
    marginBottom: 16,
  },
  passwordInput: {
    marginBottom: 0,
    paddingRight: 48,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  roleRow: {
    marginBottom: 24,
  },
  roleLabel: {
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
  },
  dropdownText: {
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
    maxWidth: 320,
    borderRadius: 12,
    overflow: 'hidden',
  },
  dropdownOption: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  dropdownOptionTextActive: {
    fontWeight: '600',
  },
  dropdownOptionLast: {
    borderBottomWidth: 0,
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
