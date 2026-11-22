/**
 * Excel/CSV-Import auf dem Server: jede Zeile prüfen (Vorschau = dryRun) und
 * dann alles in einer Transaktion anlegen. Bestehende Datensätze werden nie
 * überschrieben, sondern übersprungen.
 *
 *  Objekte:     Duplikat = gleiche Adresse + Ort in der Firma.
 *               Hausverwaltung per Name zugeordnet, sonst neu angelegt.
 *               IDs fortlaufend wie im Objekt-Dialog, systemweit frei.
 *  Mitarbeiter: Duplikat = E-Mail ist irgendwo registriert.
 *               Jeder bekommt ein zufälliges Startpasswort, das nur in der
 *               Antwort des Imports steht (Zugangsdaten-Liste zum Herunterladen).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import sql, { withTenant, type Db } from '@/lib/db';
import { isAdminLike } from '@/lib/permissions';
import type { SessionPayload } from '@/lib/auth-server';
import {
  MAX_IMPORT_ROWS,
  ROLE_LABELS,
  parseBool,
  parseContract,
  parseMonths,
  parseNumber,
  parseRole,
  parseServices,
  type ImportRow,
} from '@/lib/import/fields';
import { serviceLabel } from '@/lib/services';
import { mailEnabled } from '@/lib/mail';
import { sendInvite } from '@/lib/account-mail';

export interface RowResult {
  /** Zeilennummer in der Datei (Kopfzeile = 1). */
  row: number;
  label: string;
  status: 'new' | 'skip' | 'error';
  messages: string[];
}

export interface ImportResult {
  rows: RowResult[];
  counts: { new: number; skip: number; error: number };
  created: number;
  /** Nur beim echten Mitarbeiter-Import. */
  credentials?: Array<{ name: string; email: string; role: string; password: string }>;
  /** Mitarbeiter-Import mit Einladungen: Anzahl versandt / Adressen, bei denen es nicht klappte. */
  invited?: number;
  inviteFailed?: string[];
  createdSiteIds?: string[];
}

export class ImportError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const key = (...parts: Array<string | null | undefined>) => parts.map(p => (p ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

function summarize(rows: RowResult[], created: number): Omit<ImportResult, 'credentials' | 'createdSiteIds'> {
  const counts = { new: 0, skip: 0, error: 0 };
  rows.forEach(r => { counts[r.status] += 1; });
  return { rows, counts, created };
}

function checkSize(rows: ImportRow[], max: number) {
  if (!Array.isArray(rows) || rows.length === 0) throw new ImportError('Keine Zeilen zum Importieren.');
  if (rows.length > max) throw new ImportError(`Höchstens ${max} Zeilen pro Import.`);
}

/* ------------------------------------------------------------- Objekte */

interface SitePlan {
  result: RowResult;
  data?: {
    name: string; address: string; city: string; postalCode: string | null; region: string | null;
    client: string | null; services: Record<string, unknown>; winter: boolean;
  };
}

async function planSites(db: Db, companyId: string, rows: ImportRow[]): Promise<SitePlan[]> {
  const existing = await db`SELECT address, city FROM job_sites WHERE company_id = ${companyId}`;
  const known = new Set(existing.map(s => key(s.address, s.city)));
  const clients = await db`SELECT name FROM clients WHERE company_id = ${companyId}`;
  const knownClients = new Set(clients.map(c => key(c.name)));
  const newClients = new Set<string>();
  const inFile = new Map<string, number>();

  return rows.map((raw, index) => {
    const row = index + 2;
    const address = raw.address?.trim() ?? '';
    const city = raw.city?.trim() ?? '';
    const name = raw.name?.trim() || [address, city].filter(Boolean).join(', ');
    const result: RowResult = { row, label: name || `Zeile ${row}`, status: 'new', messages: [] };
    const errors: string[] = [];

    if (!address) errors.push('Straße fehlt');
    if (!city) errors.push('Ort fehlt');
    const postalCode = raw.postalCode?.replace(/\s/g, '') || null;
    if (postalCode && !/^\d{5}$/.test(postalCode)) errors.push(`PLZ „${raw.postalCode}“ muss 5 Ziffern haben`);
    const months = parseMonths(raw.months);
    if (!months) errors.push(`Monate „${raw.months}“ nicht lesbar (z. B. „Apr-Okt“ oder „3, 6, 9“)`);
    const winter = raw.winter ? parseBool(raw.winter) : false;
    if (winter === null) errors.push(`Winterdienst „${raw.winter}“: bitte ja oder nein`);
    if (name.length > 200) errors.push('Bezeichnung zu lang');

    if (errors.length) return { result: { ...result, status: 'error', messages: errors } };

    const k = key(address, city);
    if (known.has(k)) return { result: { ...result, status: 'skip', messages: ['Objekt mit dieser Adresse gibt es schon'] } };
    if (inFile.has(k)) return { result: { ...result, status: 'skip', messages: [`Doppelt in der Datei (wie Zeile ${inFile.get(k)})`] } };
    inFile.set(k, row);

    const services = parseServices(raw.services, months!);
    const own = Object.entries(services).filter(([, s]) => s.label).map(([code, s]) => serviceLabel(code, { [code]: s }));
    if (own.length) result.messages.push(`Eigene Leistung: ${own.join(', ')}`);
    if (raw.services && raw.months) result.messages.push(`Monate: ${months!.length === 12 ? 'ganzjährig' : months!.map(m => m.trim()).join(' ')}`);
    const client = raw.client?.trim() || null;
    if (client && !knownClients.has(key(client)) && !newClients.has(key(client))) {
      newClients.add(key(client));
      result.messages.push(`Hausverwaltung „${client}“ wird angelegt`);
    }
    return {
      result,
      data: { name, address, city, postalCode, region: raw.region?.trim() || null, client, services, winter: winter ?? false },
    };
  });
}

/** Nächste freie Objekt-IDs: fortlaufend wie im Dialog ("0042"), systemweit eindeutig. */
async function nextSiteIds(db: Db, companyId: string, count: number): Promise<string[]> {
  const own = await db`SELECT id FROM job_sites WHERE company_id = ${companyId}`;
  let n = own.reduce((max, s) => {
    const v = parseInt(String(s.id).replace(/\D/g, ''), 10);
    return Number.isFinite(v) && v < 1e7 ? Math.max(max, v) : max;
  }, 0);
  const ids: string[] = [];
  while (ids.length < count) {
    const batch = Array.from({ length: count - ids.length + 20 }, () => String(++n).padStart(4, '0'));
    // Plattformweit prüfen (der Primärschlüssel gilt für alle Firmen).
    const taken = new Set((await sql`SELECT id FROM job_sites WHERE id = ANY(${sql.array(batch)}::text[])`).map(r => r.id as string));
    for (const id of batch) if (!taken.has(id) && ids.length < count) ids.push(id);
  }
  return ids;
}

export async function importSites(session: SessionPayload, rows: ImportRow[], { dryRun }: { dryRun: boolean }): Promise<ImportResult> {
  checkSize(rows, MAX_IMPORT_ROWS.sites);
  const companyId = session.companyId;
  return withTenant(companyId, async db => {
    const plans = await planSites(db, companyId, rows);
    const todo = plans.filter(p => p.result.status === 'new' && p.data);
    if (dryRun || todo.length === 0) return { ...summarize(plans.map(p => p.result), 0), createdSiteIds: [] };

    const clientIds = new Map<string, string>();
    (await db`SELECT id, name FROM clients WHERE company_id = ${companyId}`).forEach(c => clientIds.set(key(c.name), c.id));
    for (const p of todo) {
      const name = p.data!.client;
      if (!name || clientIds.has(key(name))) continue;
      const id = `client-${randomUUID()}`;
      await db`INSERT INTO clients (id, company_id, name) VALUES (${id}, ${companyId}, ${name.slice(0, 200)})`;
      clientIds.set(key(name), id);
    }

    const ids = await nextSiteIds(db, companyId, todo.length);
    const records = todo.map((p, i) => ({
      id: ids[i],
      company_id: companyId,
      name: p.data!.name,
      address: p.data!.address,
      city: p.data!.city,
      postal_code: p.data!.postalCode,
      region: p.data!.region,
      route_code: p.data!.region,
      services: p.data!.services,
      winter_service_enabled: p.data!.winter,
      client_id: p.data!.client ? clientIds.get(key(p.data!.client)) ?? null : null,
    }));
    for (let i = 0; i < records.length; i += 200) {
      const chunk = records.slice(i, i + 200).map(r => ({ ...r, services: db.json(r.services as never) }));
      await db`INSERT INTO job_sites ${db(chunk as never[])}`;
    }
    return { ...summarize(plans.map(p => p.result), records.length), createdSiteIds: ids };
  });
}

/* --------------------------------------------------------- Mitarbeiter */

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generatePassword(length = 14): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

interface UserPlan {
  result: RowResult;
  data?: {
    name: string; email: string; role: string; contractType: string; hourlyRate: number;
    monthlyTargetHours: number | null; taxClass: number; svNr: string | null; steuerId: string | null;
  };
}

async function planUsers(session: SessionPayload, rows: ImportRow[]): Promise<UserPlan[]> {
  const emails = rows.map(r => r.email?.trim().toLowerCase()).filter((e): e is string => !!e);
  // Plattformweit: eine E-Mail darf nur einmal existieren.
  const taken = new Set(
    emails.length
      ? (await sql`SELECT lower(email) AS email FROM users WHERE lower(email) = ANY(${sql.array(emails)}::text[])`).map(r => r.email as string)
      : [],
  );
  const inFile = new Map<string, number>();

  return rows.map((raw, index) => {
    const row = index + 2;
    const name = (raw.name?.trim() || [raw.firstName, raw.lastName].map(s => s?.trim()).filter(Boolean).join(' ')).replace(/\s+/g, ' ');
    const email = raw.email?.trim().toLowerCase() ?? '';
    const result: RowResult = { row, label: name || email || `Zeile ${row}`, status: 'new', messages: [] };
    const errors: string[] = [];

    if (!name) errors.push('Name fehlt');
    if (!email) errors.push('E-Mail fehlt');
    else if (!EMAIL_RE.test(email)) errors.push(`E-Mail „${raw.email}“ ungültig`);
    const role = parseRole(raw.role);
    if (!role) errors.push(`Rolle „${raw.role}“ unbekannt`);
    else if (role === 'ADMIN' && !isAdminLike(session)) errors.push('Nur Administratoren dürfen Admin-Konten anlegen');
    const contractType = parseContract(raw.contractType);
    if (!contractType) errors.push(`Vertragsart „${raw.contractType}“ unbekannt`);
    const hourlyRate = raw.hourlyRate ? parseNumber(raw.hourlyRate) : 15;
    if (hourlyRate == null || hourlyRate < 0 || hourlyRate > 1000) errors.push(`Stundenlohn „${raw.hourlyRate}“ ungültig`);
    const target = raw.monthlyTargetHours ? parseNumber(raw.monthlyTargetHours) : null;
    if (raw.monthlyTargetHours && (target == null || target < 0 || target > 400)) errors.push(`Soll-Stunden „${raw.monthlyTargetHours}“ ungültig`);
    const taxClass = raw.taxClass ? parseNumber(raw.taxClass) : 1;
    if (taxClass == null || !Number.isInteger(taxClass) || taxClass < 1 || taxClass > 6) errors.push(`Steuerklasse „${raw.taxClass}“ muss 1–6 sein`);

    if (errors.length) return { result: { ...result, status: 'error', messages: errors } };
    if (taken.has(email)) return { result: { ...result, status: 'skip', messages: ['E-Mail ist bereits registriert'] } };
    if (inFile.has(email)) return { result: { ...result, status: 'skip', messages: [`Doppelt in der Datei (wie Zeile ${inFile.get(email)})`] } };
    inFile.set(email, row);

    result.messages.push([ROLE_LABELS[role!], contractType!.charAt(0) + contractType!.slice(1).toLowerCase(), `${hourlyRate!.toLocaleString('de-DE')} €/h`].join(' · '));
    return {
      result,
      data: {
        name: name.slice(0, 200), email, role: role!, contractType: contractType!, hourlyRate: hourlyRate!,
        monthlyTargetHours: target == null ? null : Math.round(target), taxClass: taxClass!,
        svNr: raw.svNr?.trim() || null, steuerId: raw.steuerId?.trim() || null,
      },
    };
  });
}

export async function importUsers(
  session: SessionPayload,
  rows: ImportRow[],
  { dryRun, sendInvites = false }: { dryRun: boolean; sendInvites?: boolean },
): Promise<ImportResult> {
  if (sendInvites && !mailEnabled()) throw new ImportError('E-Mail-Versand ist auf diesem Server nicht eingerichtet.');
  checkSize(rows, MAX_IMPORT_ROWS.users);
  const plans = await planUsers(session, rows);
  const todo = plans.filter(p => p.result.status === 'new' && p.data);
  if (dryRun || todo.length === 0) return summarize(plans.map(p => p.result), 0);

  // Passwörter vor der Transaktion hashen (bcrypt ist langsam).
  const prepared = await Promise.all(todo.map(async p => {
    // Mit Einladung legt jeder sein Passwort selbst fest; das zufällige bleibt unbekannt.
    const password = generatePassword(sendInvites ? 24 : 14);
    return { ...p.data!, password, hash: await bcrypt.hash(password, 11) };
  }));

  const ids = await withTenant(session.companyId, async db => {
    const created: string[] = [];
    for (const u of prepared) {
      const [row] = await db`
        INSERT INTO users (company_id, name, email, password_hash, role, contract_type, hourly_rate,
                           monthly_target_hours, tax_class, sv_nr, steuer_id)
        VALUES (${session.companyId}, ${u.name}, ${u.email}, ${u.hash}, ${u.role}, ${u.contractType}, ${u.hourlyRate},
                ${u.monthlyTargetHours}, ${u.taxClass}, ${u.svNr}, ${u.steuerId})
        RETURNING id::text AS id
      `;
      created.push(row.id as string);
    }
    return created;
  });

  if (sendInvites) {
    const failed: string[] = [];
    for (const [i, id] of ids.entries()) {
      try {
        await sendInvite(id, { userId: session.userId, name: session.name });
      } catch (error) {
        console.error('[import] invite', error);
        failed.push(prepared[i].email);
      }
    }
    return { ...summarize(plans.map(p => p.result), prepared.length), invited: ids.length - failed.length, inviteFailed: failed };
  }

  return {
    ...summarize(plans.map(p => p.result), prepared.length),
    credentials: prepared.map(u => ({ name: u.name, email: u.email, role: ROLE_LABELS[u.role], password: u.password })),
  };
}
