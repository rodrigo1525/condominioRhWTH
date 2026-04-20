import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  useColorScheme,
  View
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GesturePressable } from '@/components/ui/gesture-pressable';
import { Colors } from '@/constants/theme';
import { auth, db, functions } from '@/lib/firebase';

interface UserItem {
  id: string;
  email: string | null;
  role: string;
}

export default function UsersScreen() {
  const insets = useSafeAreaInsets();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resettingEmail, setResettingEmail] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const tintColor = Colors[colorScheme ?? 'light'].tint;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'user'));
      const list: UserItem[] = snap.docs
        .map((d) => ({
          id: d.id,
          email: d.data().email ?? null,
          role: d.data().role ?? 'user',
        }))
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
      setUsers(list);
    } catch (err) {
      console.error(err);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleSendResetEmail = async (email: string) => {
    if (!email) return;
    setResettingEmail(email);
    try {
      await sendPasswordResetEmail(auth, email);
      Alert.alert('Enviado', 'Se ha enviado un correo para restablecer la contraseña.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo enviar el correo.';
      Alert.alert('Error', msg);
    } finally {
      setResettingEmail(null);
    }
  };

  const generateResetLink = httpsCallable<{ email: string }, { link: string }>(
    functions,
    'generateResetLinkAsAdmin'
  );

  const handleCopyResetLink = async (email: string) => {
    if (!email) return;
    setLinkEmail(email);
    try {
      const { data } = await generateResetLink({ email });
      if (data?.link) {
        await Clipboard.setStringAsync(data.link);
        Alert.alert(
          'Link copiado',
          'El link de restablecimiento se ha copiado al portapapeles. Compártelo si el correo no llega.'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo generar el link.';
      Alert.alert('Error', msg);
    } finally {
      setLinkEmail(null);
    }
  };

  const renderItem = ({ item }: { item: UserItem }) => {
    const email = item.email ?? '(sin correo)';
    const isResetting = resettingEmail === email;
    const isLinking = linkEmail === email;

    return (
      <View style={[ { backgroundColor: colorScheme === 'dark' ? '#2a2a2a' : '#f5f5f5' }]}>
        <ThemedText style={styles.email}>{email}</ThemedText>
      <View style={[styles.row, { backgroundColor: colorScheme === 'dark' ? '#2a2a2a' : '#f5f5f5' }]}>

        <View style={styles.rowMain}>
          <ThemedText style={styles.role}>{item.role === 'admin' ? 'Administrador' : 'Usuario'}</ThemedText>
        </View>
        <View style={styles.actions}>
          <GesturePressable
            style={[styles.smallBtn, { borderColor: tintColor }]}
            onPress={() => handleSendResetEmail(email)}
            disabled={isResetting || !item.email}
          >
            {isResetting ? (
              <ActivityIndicator size="small" color={tintColor} />
            ) : (
              <ThemedText style={[styles.smallBtnText, { color: tintColor }]}>Reset contraseña</ThemedText>
            )}
          </GesturePressable>
          <GesturePressable
            style={[styles.smallBtn, { borderColor: tintColor }]}
            onPress={() => handleCopyResetLink(email)}
            disabled={isLinking || !item.email}
          >
            {isLinking ? (
              <ActivityIndicator size="small" color={tintColor} />
            ) : (
              <ThemedText style={[styles.smallBtnText, { color: tintColor }]}>Link respaldo</ThemedText>
            )}
          </GesturePressable>
        </View>
      </View>
      </View>
    );
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={tintColor} />
        <ThemedText style={styles.loadingText}>Cargando usuarios...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.wrapper}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ThemedText type="title" style={styles.title}>
        Usuarios
      </ThemedText>
      <ThemedText style={styles.subtitle}>
        Envía reset por correo o copia el link de respaldo.
      </ThemedText>

      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + insets.bottom }]}
        ListEmptyComponent={
          <ThemedText style={styles.empty}>No hay usuarios en la base de datos.</ThemedText>
        }
      />

      <GesturePressable style={[styles.backBtn, { backgroundColor: tintColor, marginBottom: insets.bottom }]} onPress={() => router.back()}>
        <ThemedText style={[styles.backBtnText, { color: colorScheme === 'dark' ? '#111' : '#fff' }]}>
          Volver al panel
        </ThemedText>
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
  title: {
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    marginBottom: 20,
    opacity: 0.8,
    textAlign: 'center',
  },
  list: {
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  rowMain: {
    flex: 1,
  },
  email: {
    fontSize: 16,
    fontWeight: '500',
  },
  role: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  smallBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 24,
  },
  backBtn: {
    height: 48,
    paddingHorizontal: 15,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
