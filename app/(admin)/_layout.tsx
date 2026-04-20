import { router, Stack } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/context/auth-context';

export default function AdminLayout() {
  const { isAuthenticated, role, loading } = useAuth();
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (isAuthenticated && role === 'admin') return;
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    const target = !isAuthenticated ? '/(auth)' : role === 'user' ? '/(user)' : '/(auth)';
    // Diferir navegación al siguiente tick para evitar bucle de actualizaciones con el Stack
    const id = setTimeout(() => router.replace(target as '/'), 0);
    return () => clearTimeout(id);
  }, [loading, isAuthenticated, role]);

  if (loading) return <View style={{ flex: 1 }} />;
  if (!isAuthenticated || role !== 'admin') return <View style={{ flex: 1 }} />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Administrador' }} />
      <Stack.Screen name="house-readings" options={{ title: 'Lecturas' }} />
      <Stack.Screen name="reading-edit" options={{ title: 'Editar lectura' }} />
      <Stack.Screen name="reading-detail" options={{ title: 'Detalle lectura' }} />
    </Stack>
  );
}
