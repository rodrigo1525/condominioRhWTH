import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

export default function IndexRedirect() {
  useEffect(() => {
    // Retrasar navegación hasta que el Root Layout y el navegador estén montados
    const id = setTimeout(() => {
      router.replace('/(auth)');
    }, 0);
    return () => clearTimeout(id);
  }, []);
  return <View style={{ flex: 1 }} />;
}
