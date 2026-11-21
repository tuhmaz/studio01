/**
 * Arbeitsvorgänge der Mitarbeiter-App, offline-fähig.
 *
 * Die App speichert jeden Vorgang (Einstempeln, Ausstempeln, Notiz) mit dem
 * Zeitpunkt, zu dem der Mitarbeiter ihn ausgelöst hat, und sendet ihn, sobald
 * Netz da ist – auch Stunden später und ggf. mehrfach. Deshalb gilt hier:
 *
 *   - Ein Vorgang = eine Anfrage = eine Transaktion (nie halb gespeichert).
 *   - Idempotent: dieselbe requestId erzeugt nichts doppelt.
 *   - Der Zeitpunkt kommt vom Gerät, aber höchstens 72 h zurück und kaum in die
 *     Zukunft; was der Server wann empfangen hat, wird zusätzlich gespeichert.
 *   - Arbeitsminuten rechnet der Server, nicht die App.
 */
import type { Db } from '@/lib/db';
import type { SessionPayload } from '@/lib/auth-server';
import { normalizeRole } from '@/lib/permissions';
import { isDataUrl, storeDataUrl } from '@/lib/media';
import { assertMayRecordTime } from '@/lib/team-lead';

export class FieldError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const MAX_DELAY_HOURS = 72;
const MAX_FUTURE_MS = 10 * 60_000;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** Zeitpunkt vom Gerät prüfen; ohne Angabe gilt "jetzt". */
export function clientTime(value: unknown, now = new Date()): Date {
  if (value == null || value === '') return now;
  if (typeof value !== 'string') throw new FieldError('Ungültiger Zeitpunkt');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new FieldError('Ungültiger Zeitpunkt');
  if (date.getTime() - now.getTime() > MAX_FUTURE_MS) throw new FieldError('Zeitpunkt liegt in der Zukunft – bitte Uhrzeit des Handys prüfen');
  if (now.getTime() - date.getTime() > MAX_DELAY_HOURS * 3_600_000) {
    throw new FieldError(`Älter als ${MAX_DELAY_HOURS} Stunden – bitte das Büro bitten, den Eintrag nachzutragen`);
  }
  return date;
}

export function requestId(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_ID_RE.test(value)) throw new FieldError('requestId fehlt oder ist ungültig');
  return value;
}

/** Auf 5 Minuten runden – wie bisher bei allen Zeiteinträgen. */
export function roundToFive(date: Date): Date {
  const step = 5 * 60_000;
  return new Date(Math.round(date.getTime() / step) * step);
}

/** Zeiteintrag des Mitarbeiters für einen Einstempel-Vorgang (App kennt ihn schon offline). */
export function ownEntryId(reqId: string) {
  return `te-${reqId}`;
}

interface Assignment {
  id: string;
  job_site_id: string | null;
  status: string;
  assigned_worker_ids: string[];
}

async function loadAssignment(db: Db, session: SessionPayload, assignmentId: unknown): Promise<Assignment> {
  if (typeof assignmentId !== 'string' || !assignmentId) throw new FieldError('Einsatz fehlt');
  const [row] = await db`
    SELECT id, job_site_id, status, assigned_worker_ids
      FROM job_assignments
     WHERE id = ${assignmentId} AND company_id = ${session.companyId}
     FOR UPDATE
  `;
  if (!row) throw new FieldError('Einsatz nicht gefunden', 404);
  const assignment = row as unknown as Assignment;
  const assigned = assignment.assigned_worker_ids ?? [];
  // Mitarbeiter nur bei eigenen Einsätzen (oder Einsätzen ohne Team); Leitung/Büro immer.
  // (WORKER hat time_entries.manage für die eigenen Einträge – daher Rolle prüfen.)
  if (normalizeRole(session.role) === 'WORKER' && assigned.length > 0 && !assigned.includes(session.userId)) {
    throw new FieldError('Einsatz nicht gefunden', 404);
  }
  return assignment;
}

export interface ClockInInput {
  assignmentId: unknown;
  requestId: unknown;
  at?: unknown;
  lat?: unknown;
  lng?: unknown;
  gpsVerified?: unknown;
}

const coord = (value: unknown, max: number) => {
  const n = Number(value);
  return value == null || value === '' || !Number.isFinite(n) || Math.abs(n) > max ? null : n;
};

/**
 * Einstempeln für das ganze Team des Einsatzes (wie bisher in der App gedacht):
 * jeder zugeteilte Mitarbeiter bekommt einen offenen Zeiteintrag, wer schon
 * eingestempelt ist, wird übersprungen. Ohne Team nur der Mitarbeiter selbst.
 */
export async function clockIn(db: Db, session: SessionPayload, input: ClockInInput) {
  const reqId = requestId(input.requestId);
  const at = roundToFive(clientTime(input.at));
  const assignment = await loadAssignment(db, session, input.assignmentId);
  await assertMayRecordTime(db, session, [assignment.id]);

  // Schon verarbeitet (Antwort ging z. B. unterwegs verloren)? Dann nichts mehr tun.
  const [done] = await db`
    SELECT id, clock_in_datetime FROM time_entries WHERE id = ${ownEntryId(reqId)} AND company_id = ${session.companyId}
  `;
  if (done) return { assignmentId: assignment.id, ownEntryId: done.id as string, clockIn: done.clock_in_datetime };
  if (assignment.status === 'COMPLETED') throw new FieldError('Einsatz ist bereits abgeschlossen', 409);

  const workers = assignment.assigned_worker_ids?.length ? assignment.assigned_worker_ids : [session.userId];
  const lat = coord(input.lat, 90);
  const lng = coord(input.lng, 180);
  const gpsVerified = input.gpsVerified === true && lat != null && lng != null;

  const valid = await db`
    SELECT id::text AS id FROM users
     WHERE company_id = ${session.companyId} AND id::text = ANY(${db.array(workers)}::text[]) AND role <> 'CLIENT'
  `;
  const validIds = new Set(valid.map(v => v.id as string));

  for (const workerId of workers) {
    if (!validIds.has(workerId)) continue;
    const own = workerId === session.userId;
    await db`
      INSERT INTO time_entries (id, company_id, employee_id, job_assignment_id, job_site_id,
                                clock_in_datetime, status, gps_verified, lat, lng, travel_bonus_minutes)
      SELECT ${own ? ownEntryId(reqId) : `te-${reqId}-${workerId.slice(0, 8)}`}, ${session.companyId}, ${workerId},
             ${assignment.id}, ${assignment.job_site_id}, ${at.toISOString()}, 'OPEN',
             ${own && gpsVerified}, ${own ? lat : null}, ${own ? lng : null}, 0
       WHERE NOT EXISTS (
               SELECT 1 FROM time_entries t
                WHERE t.company_id = ${session.companyId}
                  AND t.employee_id = ${workerId}
                  AND t.job_assignment_id = ${assignment.id}
                  AND t.status = 'OPEN'
             )
      ON CONFLICT DO NOTHING
    `;
  }

  if (assignment.status === 'PENDING') {
    await db`UPDATE job_assignments SET status = 'IN_PROGRESS' WHERE id = ${assignment.id} AND company_id = ${session.companyId}`;
  }

  const [own] = await db`
    SELECT id, clock_in_datetime FROM time_entries
     WHERE company_id = ${session.companyId} AND job_assignment_id = ${assignment.id}
       AND employee_id = ${session.userId} AND status = 'OPEN'
     ORDER BY clock_in_datetime DESC LIMIT 1
  `;
  return { assignmentId: assignment.id, ownEntryId: own?.id ?? null, clockIn: own?.clock_in_datetime ?? at.toISOString() };
}

export interface ClockOutInput {
  assignmentId: unknown;
  requestId: unknown;
  at?: unknown;
  travelBonusMinutes?: unknown;
}

/**
 * Ausstempeln: schließt alle offenen Zeiteinträge des Einsatzes (ganzes Team)
 * zum angegebenen Zeitpunkt und schließt den Einsatz ab. Bereits geschlossene
 * Einträge bleiben unverändert – ein erneutes Senden ändert nichts.
 */
export async function clockOut(db: Db, session: SessionPayload, input: ClockOutInput) {
  requestId(input.requestId);
  const at = roundToFive(clientTime(input.at));
  const assignment = await loadAssignment(db, session, input.assignmentId);
  await assertMayRecordTime(db, session, [assignment.id]);
  const bonus = input.travelBonusMinutes == null ? 0 : Math.round(Number(input.travelBonusMinutes));
  if (!Number.isFinite(bonus) || bonus < -120 || bonus > 240) throw new FieldError('Ungültiger Fahrtzeit-Ausgleich');

  const closed = await db`
    UPDATE time_entries t SET
      clock_out_datetime   = greatest(t.clock_in_datetime, ${at.toISOString()}::timestamptz),
      actual_work_minutes  = greatest(0, round(extract(epoch FROM (greatest(t.clock_in_datetime, ${at.toISOString()}::timestamptz) - t.clock_in_datetime)) / 60))::int,
      travel_bonus_minutes = CASE WHEN t.employee_id = ${session.userId} THEN ${bonus} ELSE t.travel_bonus_minutes END,
      status               = 'SUBMITTED',
      submission_datetime  = now()
     WHERE t.company_id = ${session.companyId}
       AND t.job_assignment_id = ${assignment.id}
       AND t.status = 'OPEN'
    RETURNING t.id, t.employee_id, t.actual_work_minutes
  `;
  if (assignment.status !== 'COMPLETED') {
    await db`UPDATE job_assignments SET status = 'COMPLETED' WHERE id = ${assignment.id} AND company_id = ${session.companyId}`;
  }
  return { assignmentId: assignment.id, closed: closed.length };
}

export interface NoteInput {
  id: unknown;
  assignmentId: unknown;
  timeEntryId?: unknown;
  type: unknown;
  content: unknown;
  duration?: unknown;
  at?: unknown;
}

const NOTE_ID_RE = /^note-[A-Za-z0-9_-]{6,80}$/;

/**
 * Notiz/Foto/Sprachnachricht zu einem Einsatz. Die App vergibt die ID, ein
 * zweites Senden liefert den vorhandenen Eintrag. Ist der offline erzeugte
 * Zeiteintrag nicht (mehr) bekannt, gilt der jüngste des Mitarbeiters für
 * diesen Einsatz.
 */
export async function addNote(db: Db, session: SessionPayload, input: NoteInput) {
  if (typeof input.id !== 'string' || !NOTE_ID_RE.test(input.id)) throw new FieldError('Ungültige Notiz-ID');
  const type = String(input.type);
  if (!['text', 'photo', 'voice'].includes(type)) throw new FieldError('Ungültiger Notiz-Typ');
  if (typeof input.content !== 'string' || !input.content.trim()) throw new FieldError('Notiz ist leer');
  if (type === 'text' && input.content.length > 5000) throw new FieldError('Text ist zu lang');
  if (type !== 'text' && !isDataUrl(input.content)) throw new FieldError('Ungültige Mediendaten');
  const at = clientTime(input.at);

  const [existing] = await db`SELECT * FROM work_log_entries WHERE id = ${input.id} AND company_id = ${session.companyId}`;
  if (existing) return existing;

  const assignment = await loadAssignment(db, session, input.assignmentId);
  const [entry] = await db`
    SELECT id FROM time_entries
     WHERE company_id = ${session.companyId}
       AND employee_id = ${session.userId}
       AND job_assignment_id = ${assignment.id}
     ORDER BY (id = ${typeof input.timeEntryId === 'string' ? input.timeEntryId : ''}) DESC, clock_in_datetime DESC
     LIMIT 1
  `;
  if (!entry) throw new FieldError('Für diesen Einsatz ist kein Zeiteintrag vorhanden – bitte zuerst einstempeln', 409);

  const content = type === 'text'
    ? input.content.trim()
    : await storeDataUrl(db, { companyId: session.companyId, userId: session.userId, kind: type as 'photo' | 'voice', dataUrl: input.content });
  const duration = input.duration == null ? null : Math.max(0, Math.round(Number(input.duration)) || 0);

  const [row] = await db`
    INSERT INTO work_log_entries (id, company_id, time_entry_id, employee_id, job_assignment_id, job_site_id,
                                  type, content, author_name, duration, created_at)
    VALUES (${input.id}, ${session.companyId}, ${entry.id}, ${session.userId}, ${assignment.id}, ${assignment.job_site_id},
            ${type}, ${content}, ${session.name}, ${duration}, ${at.toISOString()})
    ON CONFLICT (id) DO NOTHING
    RETURNING *
  `;
  if (row) return row;
  const [again] = await db`SELECT * FROM work_log_entries WHERE id = ${input.id} AND company_id = ${session.companyId}`;
  return again;
}
