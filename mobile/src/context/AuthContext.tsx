import React, { createContext, useContext, useEffect, useState } from 'react';
import { getToken, setToken, clearToken, setUnauthorizedHandler } from '@/api/client';
import { login as apiLogin, logout as apiLogout, verifySession, rememberProfile, rememberedProfile, MobileUser } from '@/api/auth';

interface AuthState {
  user:      MobileUser | null;
  token:     string | null;
  loading:   boolean;
  login:     (email: string, password: string) => Promise<void>;
  logout:    () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null, token: null, loading: true,
  login: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<MobileUser | null>(null);
  const [token,   setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Drop the session locally when any authenticated request returns 401
  // (token expired or revoked server-side). RootLayoutNav then routes to /login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken().catch(() => {});
      rememberProfile(null).catch(() => {});
      setTokenState(null);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Restore session on app start
  useEffect(() => {
    (async () => {
      try {
        const stored = await getToken();
        if (stored) {
          try {
            const profile = await verifySession(stored);
            if (profile) {
              setTokenState(stored);
              setUser(profile);
              await rememberProfile(profile);
            } else {
              // Vom Server abgelehnt (abgelaufen/widerrufen) — abmelden.
              await clearToken();
              await rememberProfile(null);
            }
          } catch {
            // Kein Netz beim Start: mit dem gemerkten Profil offline weiterarbeiten.
            // Lehnt der Server die Sitzung später ab (401), meldet die App ab.
            const cached = await rememberedProfile();
            if (cached) {
              setTokenState(stored);
              setUser(cached);
            }
          }
        }
      } catch {
        // SecureStore nicht lesbar – Anmeldung anzeigen.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const { token: t, user: u } = await apiLogin(email, password);
    await setToken(t);
    await rememberProfile(u);
    setTokenState(t);
    setUser(u);
  };

  const logout = async () => {
    await apiLogout();
    setTokenState(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
