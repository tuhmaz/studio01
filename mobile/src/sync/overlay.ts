/**
 * Noch nicht gesendete Vorgänge über geladene Daten legen – reine Funktionen,
 * ohne Netz und Speicher (dadurch testbar).
 */
import type { MobileUser } from '@/api/auth';
import type { Op } from '@/sync/outbox';

// ── Typen ────────────────────────────────────────────────────────────────────

export interface Assignment {
  id: string;
  title: string;
  status: string;
  scheduled_date: string;
  job_site_id: string | null;
  categories: string[];
  assigned_worker_ids: string[];
  /** Zugeteilte Teamleiter – sie stempeln das Team ein und aus. */
  team_leads?: string[];
}

export interface JobSite {
  id: string;
  name: string;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
  is_remote?: boolean;
  distance_from_hq?: number | null;
  travel_time_from_hq?: number | null;
  estimated_travel_time_minutes_from_hq?: number | null;
}

export interface TimeEntry {
  id: string;
  clock_in_datetime: string;
  status: string;
  job_assignment_id: string;
  job_site_id?: string | null;
  employee_id: string;
  /** Nur lokal: noch nicht beim Server. */
  pending?: boolean;
}

export interface TrackingData {
  assignments: Assignment[];
  sites: Record<string, JobSite>;
  activeEntry: TimeEntry | null;
  /** true = Daten aus dem Zwischenspeicher (kein Netz). */
  offline: boolean;
  savedAt: string | null;
}

export type ChecklistStatus = 'started' | 'done' | 'not_possible';

export interface ChecklistItem {
  code: string;
  label: string;
  check: null | {
    status: ChecklistStatus;
    reason: string | null;
    before_url: string | null;
    after_url: string | null;
    pending?: boolean;
  };
}

export interface ChecklistData {
  assignment: { id: string; date: string; site: { name: string } | null; title: string };
  items: ChecklistItem[];
  offline?: boolean;
}

export interface NoteEntry {
  id: string;
  type: string;
  content: string;
  author_name: string;
  created_at: string;
  duration?: number | null;
  pending?: boolean;
}

// ── Überlagerung mit wartenden Vorgängen ─────────────────────────────────────

export function overlayTracking(base: TrackingData, ops: Op[], user: MobileUser): TrackingData {
  let activeEntry = base.activeEntry;
  const status = new Map(base.assignments.map(a => [a.id, a.status]));
  for (const op of ops) {
    if (op.kind === 'clock_in') {
      status.set(op.assignmentId, 'IN_PROGRESS');
      if (!activeEntry || activeEntry.job_assignment_id !== op.assignmentId) {
        activeEntry = {
          id: `te-${op.body.requestId as string}`,
          clock_in_datetime: op.body.at as string,
          status: 'OPEN',
          job_assignment_id: op.assignmentId,
          job_site_id: base.assignments.find(a => a.id === op.assignmentId)?.job_site_id ?? null,
          employee_id: user.id,
          pending: true,
        };
      }
    } else if (op.kind === 'clock_out') {
      status.set(op.assignmentId, 'COMPLETED');
      if (activeEntry?.job_assignment_id === op.assignmentId) activeEntry = null;
    }
  }
  return {
    ...base,
    activeEntry,
    assignments: base.assignments.map(a => ({ ...a, status: status.get(a.id) ?? a.status })),
  };
}

export function overlayChecklist(base: ChecklistData, ops: Op[]): ChecklistData {
  const items = base.items.map(item => ({ ...item, check: item.check ? { ...item.check } : null }));
  for (const op of ops) {
    if (op.kind !== 'check' || op.assignmentId !== base.assignment.id) continue;
    const item = items.find(i => i.code === op.body.serviceCode);
    if (!item) continue;
    const st = op.body.status as ChecklistStatus | 'open';
    if (st === 'open') { item.check = null; continue; }
    const prev = item.check;
    item.check = {
      // Ein Vorher-Foto macht eine erledigte Leistung nicht wieder "begonnen".
      status: st === 'started' && prev && prev.status !== 'started' ? prev.status : st,
      reason: st === 'not_possible' ? (op.body.reason as string) : st === 'started' ? prev?.reason ?? null : null,
      before_url: (op.body.beforePhoto as string | undefined) ?? prev?.before_url ?? null,
      after_url: (op.body.afterPhoto as string | undefined) ?? prev?.after_url ?? null,
      pending: true,
    };
  }
  return { ...base, items };
}

export function overlayNotes(base: NoteEntry[], ops: Op[], assignmentId: string, user: MobileUser): NoteEntry[] {
  const known = new Set(base.map(n => n.id));
  const pending = ops
    .filter(op => op.kind === 'note' && op.assignmentId === assignmentId && !known.has(op.body.id as string))
    .map(op => ({
      id: op.body.id as string,
      type: op.body.type as string,
      content: op.body.content as string,
      author_name: user.name,
      created_at: op.body.at as string,
      duration: (op.body.duration as number | null) ?? null,
      pending: true,
    }));
  return [...pending.reverse(), ...base];
}

