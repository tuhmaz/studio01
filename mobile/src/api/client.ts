/**
 * Base API client for the Hausmeister Pro backend.
 * Reads the server URL from secure storage so workers can configure it once.
 */
import * as SecureStore from 'expo-secure-store';

export const TOKEN_KEY   = 'hp_token';
export const SERVER_KEY  = 'hp_server_url';
export const DEFAULT_URL = 'http://192.168.2.48:9002'; // local dev server

export async function getServerUrl(): Promise<string> {
  const stored = await SecureStore.getItemAsync(SERVER_KEY);
  return stored?.trim() || DEFAULT_URL;
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: object;
  token?: string | null;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiOptions = {},
  timeoutMs = 10000,
): Promise<T> {
  const base  = await getServerUrl();
  const token = options.token !== undefined ? options.token : await getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method:  options.method ?? 'GET',
      headers,
      body:    options.body ? JSON.stringify(options.body) : undefined,
      signal:  controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Verbindung zum Server hat zu lange gedauert. Bitte prüfe deine Internetverbindung.');
    }
    throw new Error('Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Data API shorthand ────────────────────────────────────────────────────────

export async function apiData<T = unknown>(body: object): Promise<{ data: T }> {
  return apiFetch<{ data: T }>('/api/data', { method: 'POST', body });
}
