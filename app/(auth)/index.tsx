import { useAuth } from '@/context/auth-context';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    TextInput,
    useColorScheme,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';

export default function LoginScreen() {
  const { isAuthenticated, role, loading, error, clearError, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (!isAuthenticated || !role) return;
    const path = role === 'admin' ? '/(admin)' : '/(user)';
    const id = setTimeout(() => router.replace(path as '/'), 0);
    return () => clearTimeout(id);
  }, [isAuthenticated, role]);

  useEffect(() => {
    clearError();
  }, [email, password, clearError]);

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch {
      // Error ya manejado en context
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.centerContainer}>
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
        style={styles.keyboardView}
      >
        <ThemedText type="title" style={styles.title}>
          Condominio RM
        </ThemedText>
        <ThemedText style={styles.subtitle}>Inicia sesión para continuar</ThemedText>

        {error ? (
          <ThemedView style={styles.errorBox}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </ThemedView>
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
            placeholder="Contraseña"
            placeholderTextColor={isDark ? '#888' : '#666'}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="password"
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

        <GesturePressable
          style={[styles.button, { backgroundColor: tintColor }]}
          onPress={handleLogin}
          disabled={submitting || !email.trim() || !password}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
          ) : (
            <ThemedText style={[styles.buttonText, { color: isDark ? '#111' : '#fff' }]}>
              Entrar
            </ThemedText>
          )}
        </GesturePressable>
      </KeyboardAvoidingView>
      <ThemedText style={styles.version}>V0.001</ThemedText>
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
    justifyContent: 'center',
    padding: 24,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    opacity: 0.8,
  },
  keyboardView: {
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 32,
    opacity: 0.8,
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
  version: {
    alignSelf: 'flex-end',
    marginTop: 24,
    opacity: 0.5,
    fontSize: 12,
  },
});
