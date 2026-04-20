import { getApps, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '';
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

if (__DEV__ && (!projectId || projectId.startsWith('tu-proyecto'))) {
  console.warn(
    '[Firebase] EXPO_PUBLIC_FIREBASE_PROJECT_ID no está configurado o es placeholder. ' +
      'Copia .env.example a .env y rellena los valores de tu proyecto en Firebase Console.'
  );
}

const isNewApp = getApps().length === 0;
const app = (isNewApp ? initializeApp(firebaseConfig) : getApps()[0]) as FirebaseApp;
export const auth = isNewApp
  ? initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    })
  : getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Región debe coincidir con la de las Cloud Functions (createUserAsAdmin, etc. están en us-central1)
const appRegion = process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION ?? 'us-central1';
export const functions = getFunctions(app, appRegion);

// Opcional: conectar a emulador en desarrollo
// if (__DEV__) connectFunctionsEmulator(functions, 'localhost', 5001);

/** Analytics (solo se inicializa en entornos donde está soportado, p. ej. web) */
export function getFirebaseAnalytics() {
  return isSupported().then((yes) => (yes ? getAnalytics(app) : null));
}
