/**
 * Zeiterfassung, Checkliste und Notizen – offline-fähig.
 *
 * Lesen: online vom Server (und merken), offline aus dem Zwischenspeicher.
 * Schreiben: über den Postausgang. Damit der Mitarbeiter sieht, was er getan
 * hat, werden noch nicht gesendete Vorgänge über die geladenen Daten gelegt
 * (eingestempelt, abgehakt, Notiz – jeweils mit "wartet auf Netz").
 */
import { ApiError, apiData, apiFetch } from '@/api/client';
import type { MobileUser } from '@/api/auth';
import { loadCache, saveCache } from '@/sync/cache';
import { newOpId, pendingOps, submit, type Op, type SubmitResult } from '@/sync/outbox';
import {
  overlayChecklist, overlayNotes, overlayTracking,
  type Assignment, type ChecklistData, type ChecklistStatus, type JobSite, type NoteEntry, type TimeEntry, type TrackingData,
} from '@/sync/overlay';

export type { Assignment, ChecklistData, ChecklistItem, JobSite, NoteEntry, TimeEntry, TrackingData } from '@/sync/overlay';
export { overlayChecklist, overlayNotes, overlayTracking } from '@/sync/overlay';

/** Netzproblem (→ Zwischenspeicher) vs. echte Antwort des Servers. */
const isNetworkError = (error: unknown) => !(error instanceof ApiError);

const trackingKey = (user: MobileUser, day: string) => `tracking-${user.id}-${day}`;
const checklistKey = (user: MobileUser, assignmentId: string) => `checklist-${user.id}-${assignmentId}`;
const notesKey = (user: MobileUser, assignmentId: string) => `notes-${user.id}-${assignmentId}`;

// ── Lesen ────────────────────────────────────────────────────────────────────

export function localDay(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function loadTracking(user: MobileUser, day = localDay()): Promise<TrackingData> {
  let base: TrackingData;
  try {
    const [aRes, sRes, eRes] = await Promise.all([
      apiData<Assignment[]>({ action: 'tracking_assignments', table: 'job_assignments', companyId: user.companyId, today: day, workerId: user.id }),
      apiData<JobSite[]>({ action: 'query', table: 'job_sites', filters: { company_id: user.companyId } }),
      apiData<TimeEntry[]>({ action: 'query', table: 'time_entries', filters: { employee_id: user.id, status: 'OPEN' } }),
    ]);
    const sites: Record<string, JobSite> = {};
    (sRes.data ?? []).forEach(s => { sites[s.id] = s; });
    base = { assignments: aRes.data ?? [], sites, activeEntry: (eRes.data ?? [])[0] ?? null, offline: false, savedAt: new Date().toISOString() };
    await saveCache(trackingKey(user, day), { assignments: base.assignments, sites: base.sites, activeEntry: base.activeEntry });
    void prefetchChecklists(user, base.assignments);
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const cached = await loadCache<Omit<TrackingData, 'offline' | 'savedAt'>>(trackingKey(user, day));
    if (!cached) throw new Error('Keine Verbindung und noch keine gespeicherten Einsätze für heute. Bitte einmal mit Netz öffnen.');
    base = { ...cached.data, offline: true, savedAt: cached.savedAt };
  }
  return overlayTracking(base, await pendingOps(user.id), user);
}

async function fetchChecklistOnline(user: MobileUser, assignmentId: string): Promise<ChecklistData> {
  const data = await apiFetch<ChecklistData>(`/api/checks?assignmentId=${encodeURIComponent(assignmentId)}`);
  await saveCache(checklistKey(user, assignmentId), data);
  return data;
}

/** Checklisten der heutigen Einsätze vorab merken – für den Keller ohne Netz. */
async function prefetchChecklists(user: MobileUser, assignments: Assignment[]) {
  for (const a of assignments) {
    if (a.status === 'COMPLETED' || !a.categories?.some(c => c !== 'WINTERDIENST')) continue;
    try { await fetchChecklistOnline(user, a.id); } catch { /* nächstes Mal */ }
  }
}

export async function loadChecklist(user: MobileUser, assignmentId: string): Promise<ChecklistData> {
  let base: ChecklistData;
  try {
    base = await fetchChecklistOnline(user, assignmentId);
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const cached = await loadCache<ChecklistData>(checklistKey(user, assignmentId));
    if (!cached) throw new Error('Checkliste ohne Netz nicht verfügbar – bitte einmal mit Netz öffnen.');
    base = { ...cached.data, offline: true };
  }
  return overlayChecklist(base, await pendingOps(user.id));
}

export async function loadNotes(user: MobileUser, assignmentId: string): Promise<{ notes: NoteEntry[]; offline: boolean }> {
  let base: NoteEntry[];
  let offline = false;
  try {
    const res = await apiData<NoteEntry[]>({
      action: 'query', table: 'work_log_entries',
      filters: { job_assignment_id: assignmentId },
      orderBy: { column: 'created_at', ascending: false },
    });
    base = res.data ?? [];
    await saveCache(notesKey(user, assignmentId), base);
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    base = (await loadCache<NoteEntry[]>(notesKey(user, assignmentId)))?.data ?? [];
    offline = true;
  }
  return { notes: overlayNotes(base, await pendingOps(user.id), assignmentId, user), offline };
}

// ── Schreiben ────────────────────────────────────────────────────────────────

function op(user: MobileUser, kind: Op['kind'], assignmentId: string, label: string, path: string, body: Record<string, unknown>): Op {
  return { id: newOpId(), kind, userId: user.id, assignmentId, createdAt: new Date().toISOString(), label, path, body };
}

export function clockIn(
  user: MobileUser,
  assignment: Assignment,
  siteName: string,
  gps: { lat: number | null; lng: number | null; verified: boolean },
): Promise<SubmitResult> {
  return submit(op(user, 'clock_in', assignment.id, `Einstempeln · ${siteName}`, '/api/field/ops', {
    op: 'clock_in',
    assignmentId: assignment.id,
    requestId: newOpId(),
    at: new Date().toISOString(),
    lat: gps.lat,
    lng: gps.lng,
    gpsVerified: gps.verified,
  }));
}

export function clockOut(user: MobileUser, assignmentId: string, siteName: string, travelBonusMinutes: number): Promise<SubmitResult> {
  return submit(op(user, 'clock_out', assignmentId, `Ausstempeln · ${siteName}`, '/api/field/ops', {
    op: 'clock_out',
    assignmentId,
    requestId: newOpId(),
    at: new Date().toISOString(),
    travelBonusMinutes,
  }));
}

export function checkService(
  user: MobileUser,
  assignmentId: string,
  item: { code: string; label: string },
  body: { status: ChecklistStatus | 'open'; reason?: string; beforePhoto?: string; afterPhoto?: string },
): Promise<SubmitResult> {
  return submit(op(user, 'check', assignmentId, `Checkliste · ${item.label}`, '/api/checks', {
    assignmentId,
    serviceCode: item.code,
    ...body,
    checkedAt: new Date().toISOString(),
  }));
}

export function addNote(
  user: MobileUser,
  entry: { id: string; job_assignment_id: string },
  note: { type: 'text' | 'photo' | 'voice'; content: string; duration?: number },
): Promise<SubmitResult> {
  const label = note.type === 'text' ? 'Notiz' : note.type === 'photo' ? 'Foto' : 'Sprachnachricht';
  return submit(op(user, 'note', entry.job_assignment_id, label, '/api/field/ops', {
    op: 'note',
    id: `note-${newOpId()}`,
    assignmentId: entry.job_assignment_id,
    timeEntryId: entry.id,
    type: note.type,
    content: note.content,
    duration: note.duration ?? null,
    at: new Date().toISOString(),
  }));
}
