/**
 * Base API client for the Hausmeister Pro backend.
 * Reads the server URL from secure storage so workers can configure it once.
 */
import * as SecureStore from 'expo-secure-store';
import * as Network from 'expo-network';

export const TOKEN_KEY   = 'hp_token';
export const SERVER_KEY  = 'hp_server_url';
// Production server by default. Override per-install via the login-screen
// settings gear, or at build time with EXPO_PUBLIC_API_URL (e.g. a LAN dev URL
// like http://10.0.2.2:9002 for the Android emulator against a local server).
export const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL || 'https://mbj.news';

// ── Global 401 handler ────────────────────────────────────────────────────────
// Registered by AuthContext. Fired when an *authenticated* request is rejected
// (token invalid/expired or revoked server-side on logout), so the app can drop
// the session and route back to the login screen instead of showing raw errors.
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn;
}

/** Error carrying the HTTP status so callers can branch on it (e.g. 401/403). */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

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

/** Prefer the API's `{ error }` message; fall back to a generic HTTP label. */
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  } catch {
    // Body was not JSON — ignore and use the generic label below.
  }
  return `HTTP ${res.status}`;
}

async function isOffline(): Promise<boolean> {
  try {
    const net = await Network.getNetworkStateAsync();
    return net?.isConnected === false;
  } catch {
    return false;
  }
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
    throw new Error(
      (await isOffline())
        ? 'Keine Internetverbindung. Bitte prüfe dein Netzwerk und versuche es erneut.'
        : 'Keine Verbindung zum Server. Bitte prüfe die Server-URL und deine Internetverbindung.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const message = await extractErrorMessage(res);
    // An authenticated request rejected as unauthorized → session is no longer
    // valid. Trigger a global logout (login screen). A 401 on an unauthenticated
    // request (e.g. wrong password on login) must NOT sign the user out.
    if (res.status === 401 && token) {
      unauthorizedHandler?.();
    }
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

// ── Data API shorthand ────────────────────────────────────────────────────────

export async function apiData<T = unknown>(body: object): Promise<{ data: T }> {
  return apiFetch<{ data: T }>('/api/data', { method: 'POST', body });
}
