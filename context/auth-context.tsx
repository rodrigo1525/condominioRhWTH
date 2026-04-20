import {
    signOut as firebaseSignOut,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { auth, db } from '@/lib/firebase';

export type UserRole = 'admin' | 'user';

export interface UserProfile {
  uid: string;
  email: string | null;
  role: UserRole;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  role: UserRole | null;
  loading: boolean;
  isLoggingOut: boolean;
  error: string | null;
  clearError: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchUserRole(uid: string): Promise<UserRole> {
  try {
    const userDoc = await getDoc(doc(db, 'user', uid));
    const data = userDoc.data();
    const raw = (data?.role ?? '') as string;
    const roleLower = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (roleLower === 'admin') return 'admin';
    return 'user';
  } catch (err) {
    // When Firestore is offline or not ready, use default role so the app doesn't crash
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('offline') || msg.includes('client is offline')) {
      return 'user';
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const fetchProfile = useCallback(async (firebaseUser: User) => {
    const role = await fetchUserRole(firebaseUser.uid);
    setProfile({
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? null,
      role,
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await fetchProfile(firebaseUser);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [fetchProfile]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setLoading(true);
      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        await fetchProfile(userCredential.user);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Error al iniciar sesión. Intenta de nuevo.';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchProfile]
  );

  const logout = useCallback(async () => {
    setError(null);
    setIsLoggingOut(true);
    try {
      await firebaseSignOut(auth);
      // user/profile se actualizan solos vía onAuthStateChanged → Redirect en layout
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Error al cerrar sesión. Intenta de nuevo.';
      setError(message);
    } finally {
      setIsLoggingOut(false);
    }
  }, []);

  const role = profile?.role ?? null;
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isAuthenticated,
        role,
        loading,
        isLoggingOut,
        error,
        clearError,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
