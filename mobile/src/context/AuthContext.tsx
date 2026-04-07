import React, { createContext, useContext, useEffect, useState } from 'react';
import { getToken, setToken } from '@/api/client';
import { login as apiLogin, logout as apiLogout, verifySession, MobileUser } from '@/api/auth';

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

  // Restore session on app start
  useEffect(() => {
    (async () => {
      try {
        const stored = await getToken();
        if (stored) {
          const profile = await verifySession(stored);
          if (profile) {
            setTokenState(stored);
            setUser(profile);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const { token: t, user: u } = await apiLogin(email, password);
    await setToken(t);
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
