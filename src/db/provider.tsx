'use client';

import React, {
  createContext, useContext, useEffect, useState, useMemo, ReactNode,
} from 'react';

export type UserRole = 'ADMIN' | 'LEADER' | 'WORKER';

export interface UserProfile {
  id: string;
  companyId: string;
  role: UserRole;
  name: string;
  email: string;
}

interface AuthState {
  userProfile: UserProfile | null;
  isUserLoading: boolean;
  userError: string | null;
  login:  (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [userProfile, setUserProfile]   = useState<UserProfile | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const [userError, setUserError]       = useState<string | null>(null);

  // On mount: check existing session
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.userId) {
          const profile: UserProfile = {
            id:        data.userId,
            companyId: data.companyId,
            role:      data.role,
            name:      data.name,
            email:     data.email,
          };
          setUserProfile(profile);
          syncLocalStorage(profile);
        } else {
          // Abgelaufene oder ungültige Sitzung — lokalen Zustand bereinigen
          clearLocalStorage();
        }
      })
      .catch(() => { clearLocalStorage(); })
      .finally(() => setIsUserLoading(false));
  }, []);

  async function login(email: string, password: string) {
    setIsUserLoading(true);
    setUserError(null);
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Anmeldung fehlgeschlagen');

      const profile: UserProfile = {
        id:        data.id,
        companyId: data.companyId,
        role:      data.role,
        name:      data.name,
        email:     data.email,
      };
      setUserProfile(profile);
      syncLocalStorage(profile);
    } catch (e: any) {
      setUserError(e.message);
      throw e;
    } finally {
      setIsUserLoading(false);
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Netzwerkfehler ignorieren — lokale Sitzung trotzdem beenden
    } finally {
      setUserProfile(null);
      clearLocalStorage();
      window.location.href = '/login';
    }
  }

  async function changePassword(newPassword: string) {
    const res = await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ newPassword }),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? 'Fehler beim Ändern des Passworts');
    }
  }

  const value = useMemo<AuthState>(
    () => ({ userProfile, isUserLoading, userError, login, logout, changePassword }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userProfile, isUserLoading, userError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AppProvider');
  return ctx;
}

// ── localStorage sync ───────────────────────────────────────────────────────

function syncLocalStorage(profile: UserProfile) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('userRole',   profile.role);
  localStorage.setItem('userName',   profile.name);
  localStorage.setItem('companyId',  profile.companyId);
  localStorage.setItem('userId',     profile.id);
}

function clearLocalStorage() {
  if (typeof window === 'undefined') return;
  ['userRole', 'userName', 'companyId', 'userId'].forEach(k => localStorage.removeItem(k));
}
