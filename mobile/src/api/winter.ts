/**
 * Winterdienst API with an offline queue.
 *
 * Clearing starts before dawn, often where the signal is poor. An entry that
 * cannot reach the server is saved on the phone and sent later; its time of
 * work (performedAt) is captured when the worker saves it, not when it is
 * finally sent, and its clientRequestId makes resending safe.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ApiError, apiFetch } from '@/api/client';

export const ACTIVITIES = {
  clearing: 'Räumen',
  gritting: 'Streuen',
  clearing_gritting: 'Räumen + Streuen',
  inspection: 'Kontrolle',
} as const;
export type Activity = keyof typeof ACTIVITIES;

export const MATERIALS = {
  salt: 'Salz',
  grit: 'Splitt',
  sand: 'Sand',
  granulate: 'Granulat',
  mixed: 'Gemisch',
} as const;
export type Material = keyof typeof MATERIALS;

export interface WinterSite {
  id: string;
  name: string;
  address: string;
  city: string;
  lat: string | null;
  lng: string | null;
  winter_areas: string[];
  winter_notes: string | null;
  last_performed_at: string | null;
  last_activity: Activity | null;
  last_employee_name: string | null;
  entries_today: number;
}

export interface WinterEntryInput {
  clientRequestId: string;
  siteId: string;
  siteName: string;
  activity: Activity;
  gritMaterial: Material | null;
  gritAmountKg: number | null;
  areas: string[];
  notes: string | null;
  performedAt: string;
  lat: number | null;
  lng: number | null;
  gpsAccuracyM: number | null;
  photo: string | null;
}

const QUEUE_DIR = `${FileSystem.documentDirectory}winter-queue/`;

/** RFC 4122 v4 id; only needs to be unique per entry, not cryptographically strong. */
export function newRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function fetchWinterSites(): Promise<WinterSite[]> {
  const { data } = await apiFetch<{ data: WinterSite[] }>('/api/winter/sites');
  return data;
}

async function send(entry: WinterEntryInput): Promise<void> {
  // siteName is only kept for messages on the phone; the server knows the site.
  const body: Record<string, unknown> = { ...entry };
  delete body.siteName;
  // Photos make the request large; allow more time than the default 10 s.
  await apiFetch('/api/winter/logs', { method: 'POST', body }, 45000);
}

async function ensureQueueDir() {
  const info = await FileSystem.getInfoAsync(QUEUE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
}

async function enqueue(entry: WinterEntryInput) {
  await ensureQueueDir();
  await FileSystem.writeAsStringAsync(`${QUEUE_DIR}${entry.clientRequestId}.json`, JSON.stringify(entry));
}

export type SubmitResult = 'sent' | 'queued';

/**
 * Sends an entry, or keeps it on the phone if there is no connection.
 * Server-side rejections (ApiError) are thrown so the worker can fix the input.
 */
export async function submitWinterEntry(entry: WinterEntryInput): Promise<SubmitResult> {
  try {
    await send(entry);
    return 'sent';
  } catch (error) {
    if (error instanceof ApiError) throw error;
    await enqueue(entry);
    return 'queued';
  }
}

export async function queuedEntries(): Promise<WinterEntryInput[]> {
  const info = await FileSystem.getInfoAsync(QUEUE_DIR);
  if (!info.exists) return [];
  const files = (await FileSystem.readDirectoryAsync(QUEUE_DIR)).filter(f => f.endsWith('.json'));
  const entries: WinterEntryInput[] = [];
  for (const file of files) {
    try {
      entries.push(JSON.parse(await FileSystem.readAsStringAsync(`${QUEUE_DIR}${file}`)));
    } catch {
      // Unreadable file: leave it for inspection rather than losing data silently.
    }
  }
  return entries.sort((a, b) => a.performedAt.localeCompare(b.performedAt));
}

export interface FlushResult {
  sent: number;
  remaining: number;
  /** Entries the server refused (e.g. older than 72 h); kept on the phone and reported. */
  rejected: Array<{ entry: WinterEntryInput; message: string }>;
}

/** Tries to send every queued entry, oldest first. Stops at the first network failure. */
export async function flushWinterQueue(): Promise<FlushResult> {
  const entries = await queuedEntries();
  let sent = 0;
  const rejected: FlushResult['rejected'] = [];
  for (const entry of entries) {
    try {
      await send(entry);
      await FileSystem.deleteAsync(`${QUEUE_DIR}${entry.clientRequestId}.json`, { idempotent: true });
      sent += 1;
    } catch (error) {
      if (error instanceof ApiError) {
        rejected.push({ entry, message: error.message });
        continue;
      }
      break;
    }
  }
  const remaining = (await queuedEntries()).length;
  return { sent, remaining, rejected };
}

export async function discardQueuedEntry(clientRequestId: string) {
  await FileSystem.deleteAsync(`${QUEUE_DIR}${clientRequestId}.json`, { idempotent: true });
}
