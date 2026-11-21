/**
 * Benachrichtigungen: anlegen, aus Einsatz-Änderungen ableiten, per Expo-Push senden.
 *
 *  - Eine Zeile je Empfänger in `notifications` (Glocke im Web, Liste in der App).
 *  - Push geht über den Expo-Push-Dienst an alle Geräte des Empfängers, in der
 *    Sprache des Geräts. Versand nach dem Speichern (Next `after`) und als
 *    Nachholung im Cron (/api/cron/notifications), falls der Dienst nicht
 *    erreichbar war.
 *  - Wer etwas selbst geändert hat, bekommt dazu keine Benachrichtigung.
 */
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import sql, { type Db } from '@/lib/db';
import { notifyLang, renderNotification, type NotificationKind } from '@/lib/notification-texts';

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  data: Record<string, string | number | null>;
  link?: string | null;
  /** Gleicher Schlüssel für denselben Empfänger = nur einmal (Erinnerungen). */
  dedupeKey?: string | null;
}

/** Legt Benachrichtigungen an (innerhalb der Mandanten-Transaktion). Liefert die Anzahl neuer Zeilen. */
export async function createNotifications(db: Db, companyId: string, items: NewNotification[]): Promise<number> {
  let created = 0;
  for (const item of items) {
    const rows = await db`
      INSERT INTO notifications (id, company_id, user_id, kind, data, link, dedupe_key)
      VALUES (${`ntf-${randomUUID()}`}, ${companyId}, ${item.userId}, ${item.kind},
              ${db.json(item.data as never)}, ${item.link ?? null}, ${item.dedupeKey ?? null})
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id
    `;
    created += rows.length;
  }
  return created;
}

/* ---------------------------------------------------------------- Einsätze */

export interface AssignmentSnapshot {
  id: string;
  title: string | null;
  scheduled_date: string | Date | null;
  assigned_worker_ids: string[] | null;
  is_plan_published: boolean | null;
  status: string | null;
}

export const ASSIGNMENT_COLUMNS = ['id', 'title', 'scheduled_date', 'assigned_worker_ids', 'is_plan_published', 'status'] as const;

function dateOnly(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  return String(value).slice(0, 10);
}

export function berlinToday(at = new Date()): string {
  return dateOnly(at)!;
}

/**
 * Was ein Mitarbeiter über eine Änderung erfahren muss. Sichtbar ist ein Einsatz
 * für ihn, wenn er veröffentlicht, nicht erledigt und heute oder später ist.
 *   neu dabei → assignment.new · nicht mehr dabei → assignment.cancelled ·
 *   Datum geändert → assignment.moved. Erledigen löst nichts aus.
 */
export function assignmentNotifications(
  before: AssignmentSnapshot | null,
  after: AssignmentSnapshot | null,
  { actorId, today = berlinToday() }: { actorId?: string | null; today?: string } = {},
): NewNotification[] {
  if (after?.status === 'COMPLETED') return [];
  const visible = (s: AssignmentSnapshot | null) => {
    const date = dateOnly(s?.scheduled_date ?? null);
    return !!s && !!s.is_plan_published && !!date && date >= today && s.status !== 'COMPLETED';
  };
  const workers = (s: AssignmentSnapshot | null) => new Set(visible(s) ? (s!.assigned_worker_ids ?? []) : []);
  const was = workers(before);
  const now = workers(after);
  const title = (after ?? before)?.title?.trim() || 'Einsatz';
  const out: NewNotification[] = [];
  const add = (userId: string, kind: NotificationKind, data: NewNotification['data']) => {
    if (userId && userId !== actorId) out.push({ userId, kind, data, link: '/tracking' });
  };

  for (const id of now) {
    if (!was.has(id)) add(id, 'assignment.new', { title, date: dateOnly(after!.scheduled_date) });
    else if (dateOnly(before!.scheduled_date) !== dateOnly(after!.scheduled_date)) {
      add(id, 'assignment.moved', { title, from: dateOnly(before!.scheduled_date), date: dateOnly(after!.scheduled_date) });
    }
  }
  for (const id of was) {
    if (!now.has(id)) add(id, 'assignment.cancelled', { title, date: dateOnly(before!.scheduled_date) });
  }
  return out;
}

/** Stand der Einsätze vor einer Änderung (für den Vergleich danach). */
export async function snapshotAssignments(db: Db, companyId: string, ids: string[]): Promise<Map<string, AssignmentSnapshot>> {
  const map = new Map<string, AssignmentSnapshot>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return map;
  const rows = await db`
    SELECT id, title, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
           assigned_worker_ids, is_plan_published, status
      FROM job_assignments
     WHERE company_id = ${companyId} AND id = ANY(${db.array(unique)}::text[])
  `;
  rows.forEach(r => map.set(r.id as string, r as unknown as AssignmentSnapshot));
  return map;
}

/** Vergleicht vorher/nachher und legt die Benachrichtigungen an. */
export async function notifyAssignmentChanges(
  db: Db,
  companyId: string,
  before: Map<string, AssignmentSnapshot>,
  afterIds: string[],
  actorId: string | null,
): Promise<number> {
  const after = await snapshotAssignments(db, companyId, afterIds);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const items = [...ids].flatMap(id => assignmentNotifications(before.get(id) ?? null, after.get(id) ?? null, { actorId }));
  if (!items.length) return 0;
  // Nur aktive Mitarbeiter derselben Firma.
  const valid = await db`
    SELECT id::text FROM users
     WHERE company_id = ${companyId} AND id::text = ANY(${db.array([...new Set(items.map(i => i.userId))])}::text[])
  `;
  const allowed = new Set(valid.map(r => r.id as string));
  const count = await createNotifications(db, companyId, items.filter(i => allowed.has(i.userId)));
  if (count) scheduleDelivery();
  return count;
}

/** Empfänger im Büro (Verwaltung) einer Firma. */
export async function officeUserIds(db: Db, companyId: string): Promise<string[]> {
  const rows = await db`
    SELECT id::text FROM users WHERE company_id = ${companyId} AND role IN ('ADMIN', 'MANAGER')
  `;
  return rows.map(r => r.id as string);
}

/* -------------------------------------------------------------- Expo-Push */

const EXPO_PUSH_URL = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const FRESH_HOURS = 6;

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: 'default';
  data: Record<string, unknown>;
}

/**
 * Verschickt alle noch nicht versendeten, frischen Benachrichtigungen (alle
 * Firmen; Cron/after). Die Zeilen werden vorher markiert, damit parallele Läufe
 * nichts doppelt senden; ist der Dienst nicht erreichbar, wird die Markierung
 * zurückgenommen und der nächste Lauf versucht es erneut.
 */
export async function deliverPendingPush(): Promise<{ sent: number; failed: number; removedTokens: number }> {
  if (process.env.PUSH_DISABLED === '1') return { sent: 0, failed: 0, removedTokens: 0 };
  const claimed = await sql`
    UPDATE notifications SET pushed_at = NOW()
     WHERE id IN (
       SELECT id FROM notifications
        WHERE pushed_at IS NULL AND created_at > NOW() - make_interval(hours => ${FRESH_HOURS})
        ORDER BY created_at
        LIMIT 500
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, company_id, user_id::text AS user_id, kind, data, link
  `;
  if (!claimed.length) return { sent: 0, failed: 0, removedTokens: 0 };

  const userIds = [...new Set(claimed.map(n => n.user_id as string))];
  const tokens = await sql`
    SELECT token, user_id::text AS user_id, lang FROM push_tokens WHERE user_id::text = ANY(${sql.array(userIds)}::text[])
  `;
  const byUser = new Map<string, Array<{ token: string; lang: string }>>();
  tokens.forEach(t => byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), { token: t.token, lang: t.lang }]));

  const messages: Array<{ notificationId: string; message: PushMessage }> = [];
  for (const n of claimed) {
    for (const device of byUser.get(n.user_id as string) ?? []) {
      const text = renderNotification(n.kind as string, n.data as Record<string, unknown>, notifyLang(device.lang));
      messages.push({
        notificationId: n.id as string,
        message: {
          to: device.token, title: text.title, body: text.body,
          sound: 'default', priority: 'high', channelId: 'default',
          data: { id: n.id, kind: n.kind, link: n.link },
        },
      });
    }
  }

  let sent = 0;
  let failed = 0;
  const deadTokens = new Set<string>();
  const retry = new Set<string>();
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk.map(c => c.message)),
        signal: globalThis.AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
      const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
      chunk.forEach((c, idx) => {
        const ticket = json.data?.[idx];
        if (ticket?.status === 'ok') sent += 1;
        else {
          failed += 1;
          if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.add(c.message.to);
        }
      });
    } catch (error) {
      console.error('[push] Versand fehlgeschlagen', error);
      failed += chunk.length;
      chunk.forEach(c => retry.add(c.notificationId));
    }
  }

  if (deadTokens.size) await sql`DELETE FROM push_tokens WHERE token = ANY(${sql.array([...deadTokens])}::text[])`;
  if (retry.size) await sql`UPDATE notifications SET pushed_at = NULL WHERE id = ANY(${sql.array([...retry])}::text[])`;
  return { sent, failed, removedTokens: deadTokens.size };
}

/** Push nach der Antwort verschicken (blockiert die Anfrage nicht). */
export function scheduleDelivery() {
  if (process.env.NODE_ENV === 'test') return;
  const run = () => deliverPendingPush().then(() => undefined, error => console.error('[push]', error));
  try {
    after(run);
  } catch {
    void run();
  }
}
