/** Gemeinsame Typen für den Leistungsnachweis (Server, Admin-Seite, Kundenportal, PDF). */

export type ItemStatus = 'done' | 'not_possible' | 'open';

export interface ReportItem {
  code: string;
  label: string;
  status: ItemStatus;
  reason: string | null;
  checkedAt: string | null;
  employeeName: string | null;
  /** Vom Büro nachgetragen, nicht vor Ort abgehakt. */
  byOffice: boolean;
  beforeUrl: string | null;
  afterUrl: string | null;
}

export interface ReportVisit {
  id: string;
  date: string;
  title: string;
  status: string;
  workers: string[];
  items: ReportItem[];
}

export interface LeistungsnachweisReport {
  site: { id: string; name: string; address: string; city: string; postalCode: string | null };
  company: {
    name: string;
    address: string | null;
    city: string | null;
    postal_code: string | null;
    phone: string | null;
    email: string | null;
  };
  month: string;
  /** false im Kundenportal, wenn der Dienstleister keine Mitarbeiternamen zeigt. */
  showWorkerNames: boolean;
  visits: ReportVisit[];
  totals: {
    visits: number;
    planned: number;
    done: number;
    notPossible: number;
    open: number;
    compliancePercent: number | null;
  };
}

/** Statustext inkl. Kennzeichnung eines Nachtrags. */
export function itemStatusText(item: Pick<ReportItem, 'status' | 'byOffice'>): string {
  return item.byOffice && item.status === 'done' ? 'erledigt (Nachtrag Büro)' : STATUS_TEXT[item.status];
}

export const STATUS_TEXT: Record<ItemStatus, string> = { done: 'erledigt', not_possible: 'nicht möglich', open: 'offen' };

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-11" → { first: "2026-11-01", next: "2026-12-01" }, sonst null. */
export function monthRange(month: string): { first: string; next: string } | null {
  const match = MONTH_RE.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const m = Number(match[2]);
  return {
    first: `${month}-01`,
    next: m === 12 ? `${year + 1}-01-01` : `${match[1]}-${String(m + 1).padStart(2, '0')}-01`,
  };
}

export function lastMonths(count: number, now = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { value, label: d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
  });
}

export const fmtReportDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

export const fmtReportTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '';
