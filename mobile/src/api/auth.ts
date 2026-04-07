import { apiFetch, setToken, clearToken } from './client';

export interface MobileUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'LEADER' | 'WORKER';
  companyId: string;
  companyName?: string;
}

export async function login(email: string, password: string): Promise<{ token: string; user: MobileUser }> {
  return apiFetch('/api/auth/mobile', {
    method: 'POST',
    body:   { email, password },
    token:  null, // no token yet
  });
}

export async function verifySession(token: string): Promise<MobileUser | null> {
  try {
    const data = await apiFetch<{
      userId: string; companyId: string; role: string; name: string; email: string;
    }>('/api/auth/mobile', { token });
    return {
      id:        data.userId,
      name:      data.name,
      email:     data.email,
      role:      data.role as MobileUser['role'],
      companyId: data.companyId,
    };
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await clearToken();
}
