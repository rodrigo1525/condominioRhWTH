import { router, Stack } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/context/auth-context';

export default function UserLayout() {
  const { isAuthenticated, role, loading } = useAuth();
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (isAuthenticated && role === 'user') return;
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    const target = !isAuthenticated ? '/(auth)' : role === 'admin' ? '/(admin)' : '/(auth)';
    const id = setTimeout(() => router.replace(target as '/'), 0);
    return () => clearTimeout(id);
  }, [loading, isAuthenticated, role]);

  if (loading) return <View style={{ flex: 1 }} />;
  if (!isAuthenticated || role !== 'user') return <View style={{ flex: 1 }} />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Mi consumo' }} />
      <Stack.Screen name="house/[id]" options={{ title: 'Histórico' }} />
      <Stack.Screen name="reading-detail" options={{ title: 'Detalle lectura' }} />
    </Stack>
  );
}
