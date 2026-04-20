import { useAuth } from '@/context/auth-context';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AdminHomeScreen() {
  const { logout, profile, isLoggingOut, error } = useAuth();
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;
  const isDark = colorScheme === 'dark';

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/(auth)');
    } catch {
      // Error mostrado en context
    }
  };

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ThemedText type="title" style={styles.title}>
        Panel Administrador
      </ThemedText>
      <ThemedText style={styles.subtitle}>
        Bienvenido, {profile?.email ?? 'Administrador'}
      </ThemedText>
      <GesturePressable
        style={[styles.menuButton, { borderColor: tintColor }]}
        onPress={() => router.push('/(admin)/create-user')}
      >
        <ThemedText style={[styles.menuButtonText, { color: tintColor }]}>Crear usuario</ThemedText>
      </GesturePressable>
      <GesturePressable
        style={[styles.menuButton, { borderColor: tintColor }]}
        onPress={() => router.push('/(admin)/users')}
      >
        <ThemedText style={[styles.menuButtonText, { color: tintColor }]}>Listado de usuarios</ThemedText>
      </GesturePressable>
      <GesturePressable
        style={[styles.menuButton, { borderColor: tintColor }]}
        onPress={() => router.push('/(admin)/houses')}
      >
        <ThemedText style={[styles.menuButtonText, { color: tintColor }]}>Gestionar casas</ThemedText>
      </GesturePressable>
      <GesturePressable
        style={[styles.menuButton, { borderColor: tintColor }]}
        onPress={() => router.push('/(admin)/reading-new')}
      >
        <ThemedText style={[styles.menuButtonText, { color: tintColor }]}>Registrar lectura</ThemedText>
      </GesturePressable>
      {error ? (
        <ThemedText style={styles.errorText}>{error}</ThemedText>
      ) : null}
      <GesturePressable
        onPress={handleLogout}
        disabled={isLoggingOut}
        style={[styles.logoutButton, { backgroundColor: tintColor, opacity: isLoggingOut ? 0.7 : 1 }]}
      >
        {isLoggingOut ? (
          <ActivityIndicator size="small" color={isDark ? '#111' : '#fff'} />
        ) : (
          <ThemedText style={[styles.logoutText, { color: isDark ? '#111' : '#fff' }]}>
            Cerrar sesión
          </ThemedText>
        )}
      </GesturePressable>
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
    alignItems: 'center',
    padding: 24,
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
  placeholder: {
    textAlign: 'center',
    marginBottom: 32,
    opacity: 0.6,
    fontStyle: 'italic',
  },
  menuButton: {
    height: 48,
    width: '100%',
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  logoutButton: {
    height: 48,
    width: '100%',
    paddingHorizontal: 15,
    borderRadius: 12,
    marginTop: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#dc3545',
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
});
