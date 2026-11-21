import * as SecureStore from 'expo-secure-store';
import { ApiError, apiFetch, clearToken } from './client';
import { normalizeRole, type Role } from '@/utils/roles';

export interface MobileUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId: string;
  companyName?: string;
}

interface LoginResponse {
  token: string;
  user: {
    id: string; name: string; email: string;
    role: string; companyId: string; companyName?: string;
  };
}

export async function login(email: string, password: string): Promise<{ token: string; user: MobileUser }> {
  const res = await apiFetch<LoginResponse>('/api/auth/mobile', {
    method: 'POST',
    body:   { email, password },
    token:  null, // no token yet
  });
  return {
    token: res.token,
    user: { ...res.user, role: normalizeRole(res.user.role) },
  };
}

const PROFILE_KEY = 'hp_profile';

/** Profil lokal merken, damit die App auch ohne Netz startet. */
export async function rememberProfile(user: MobileUser | null): Promise<void> {
  if (user) await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(user));
  else await SecureStore.deleteItemAsync(PROFILE_KEY);
}

export async function rememberedProfile(): Promise<MobileUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as MobileUser) : null;
  } catch {
    return null;
  }
}

/**
 * Prüft die Sitzung beim Server.
 * null = vom Server abgelehnt (abgelaufen/widerrufen) → abmelden.
 * Wirft bei Netzproblemen → Sitzung behalten und offline weiterarbeiten.
 */
export async function verifySession(token: string): Promise<MobileUser | null> {
  try {
    const data = await apiFetch<{
      userId: string; companyId: string; role: string; name: string; email: string;
    }>('/api/auth/mobile', { token });
    return {
      id:        data.userId,
      name:      data.name,
      email:     data.email,
      role:      normalizeRole(data.role),
      companyId: data.companyId,
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export async function logout(): Promise<void> {
  // Best-effort server-side revocation; always clear the local token afterwards.
  try {
    await apiFetch('/api/auth/mobile', { method: 'DELETE' });
  } catch {
    // Offline or already-invalid token — local logout still proceeds.
  }
  await clearToken();
  await rememberProfile(null);
}
