/**
 * Postausgang der App: jeder Arbeitsvorgang wird zuerst auf dem Handy gespeichert
 * und dann – sofort oder sobald wieder Netz da ist – in der richtigen Reihenfolge
 * an den Server geschickt.
 *
 *  - Reihenfolge: Ist schon etwas im Postausgang, wird ein neuer Vorgang hinten
 *    angestellt (sonst käme z. B. "Ausstempeln" vor "Einstempeln" an).
 *  - Zeitpunkt: kommt aus dem Vorgang (`at`/`checkedAt`), nicht aus dem Senden.
 *  - Wiederholungen sind ungefährlich (Server ist idempotent).
 *  - Lehnt der Server einen Vorgang ab (4xx), wandert er in "Nicht gespeichert"
 *    und wird dem Mitarbeiter gezeigt – er geht nie stillschweigend verloren.
 *  - Jeder Vorgang gehört einem Benutzer; gesendet wird nur mit dessen Anmeldung.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ApiError, apiFetch } from '@/api/client';

export type OpKind = 'clock_in' | 'clock_out' | 'check' | 'note';

export interface Op {
  id: string;
  kind: OpKind;
  userId: string;
  assignmentId: string;
  /** Wann der Mitarbeiter es ausgelöst hat (ISO). */
  createdAt: string;
  /** Kurzer Text für Anzeige ("Einstempeln · Lindenhof"). */
  label: string;
  path: string;
  body: Record<string, unknown>;
}

export interface FailedOp extends Op {
  error: string;
  failedAt: string;
}

const DIR = `${FileSystem.documentDirectory}outbox/`;
const FAILED_DIR = `${FileSystem.documentDirectory}outbox-failed/`;

type Listener = () => void;
const listeners = new Set<Listener>();
export function onOutboxChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });

async function ensure(dir: string) {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

const fileName = (op: Op) => `${new Date(op.createdAt).getTime().toString().padStart(15, '0')}-${op.id}.json`;

async function readDir<T>(dir: string): Promise<Array<{ file: string; value: T }>> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return [];
  const files = (await FileSystem.readDirectoryAsync(dir)).filter(f => f.endsWith('.json')).sort();
  const out: Array<{ file: string; value: T }> = [];
  for (const file of files) {
    try {
      out.push({ file, value: JSON.parse(await FileSystem.readAsStringAsync(`${dir}${file}`)) });
    } catch {
      // Unlesbare Datei liegen lassen statt Daten still zu verlieren.
    }
  }
  return out;
}

export async function pendingOps(userId?: string): Promise<Op[]> {
  const all = (await readDir<Op>(DIR)).map(x => x.value);
  return userId ? all.filter(o => o.userId === userId) : all;
}

export async function failedOps(userId?: string): Promise<FailedOp[]> {
  const all = (await readDir<FailedOp>(FAILED_DIR)).map(x => x.value);
  return userId ? all.filter(o => o.userId === userId) : all;
}

async function store(op: Op) {
  await ensure(DIR);
  await FileSystem.writeAsStringAsync(`${DIR}${fileName(op)}`, JSON.stringify(op));
  notify();
}

async function remove(op: Op) {
  await FileSystem.deleteAsync(`${DIR}${fileName(op)}`, { idempotent: true });
}

async function moveToFailed(op: Op, error: string) {
  await ensure(FAILED_DIR);
  const failed: FailedOp = { ...op, error, failedAt: new Date().toISOString() };
  await FileSystem.writeAsStringAsync(`${FAILED_DIR}${fileName(op)}`, JSON.stringify(failed));
  await remove(op);
}

export async function discardFailed(op: FailedOp) {
  await FileSystem.deleteAsync(`${FAILED_DIR}${fileName(op)}`, { idempotent: true });
  notify();
}

/** Abgelehnten Vorgang noch einmal versuchen (z. B. nach Korrektur im Büro). */
export async function retryFailed(op: FailedOp) {
  await FileSystem.deleteAsync(`${FAILED_DIR}${fileName(op)}`, { idempotent: true });
  const { error: _e, failedAt: _f, ...plain } = op;
  await store(plain);
}

/** Netzfehler/Serverstörung (später erneut) vs. Ablehnung des Inhalts (anzeigen). */
function isRejection(error: unknown) {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 408 && error.status !== 429;
}

async function send(op: Op) {
  // Fotos und Sprachnachrichten brauchen länger als die üblichen 10 s.
  await apiFetch(op.path, { method: 'POST', body: op.body }, 60000);
}

export type SubmitResult = 'sent' | 'queued';

/**
 * Vorgang ausführen. Antwortet der Server, ist er gespeichert ('sent');
 * ohne Netz wartet er im Postausgang ('queued'). Eine inhaltliche Ablehnung
 * wird geworfen, damit der Mitarbeiter sie sofort sieht.
 */
export async function submit(op: Op): Promise<SubmitResult> {
  const waiting = await pendingOps(op.userId);
  if (waiting.length > 0) {
    await store(op);
    void flush(op.userId);
    return 'queued';
  }
  try {
    await send(op);
    notify();
    return 'sent';
  } catch (error) {
    if (isRejection(error)) throw error;
    await store(op);
    return 'queued';
  }
}

let flushing: Promise<FlushResult> | null = null;

export interface FlushResult {
  sent: number;
  remaining: number;
  newlyFailed: number;
}

/** Alle wartenden Vorgänge des Benutzers in Reihenfolge senden; bei Netzfehler anhalten. */
export function flush(userId: string): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let newlyFailed = 0;
    try {
      // Bis der Postausgang leer ist – auch Vorgänge, die während des Sendens
      // dazukommen, gehen in derselben Runde raus.
      let stalled = false;
      while (!stalled) {
        const batch = await pendingOps(userId);
        if (batch.length === 0) break;
        for (const op of batch) {
          try {
            await send(op);
            await remove(op);
            sent += 1;
          } catch (error) {
            if (isRejection(error)) {
              await moveToFailed(op, (error as Error).message);
              newlyFailed += 1;
              continue;
            }
            stalled = true; // kein Netz / Server gestört / Sitzung: später weiter
            break;
          }
        }
      }
    } finally {
      flushing = null;
      notify();
    }
    return { sent, remaining: (await pendingOps(userId)).length, newlyFailed };
  })();
  return flushing;
}

/** Eindeutige ID (RFC-4122-Format), offline erzeugbar. */
export function newOpId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
