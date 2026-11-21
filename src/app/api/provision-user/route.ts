import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { getSession } from '@/lib/auth-server';
import { hasPermission, isAdminLike } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { getRequestIp, getUserAgent } from '@/lib/request-context';

const ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER'] as const;
const CONTRACT_TYPES = ['MINIJOB', 'MIDIJOB', 'VOLLZEIT', 'TEILZEIT'] as const;
const MIN_PASSWORD_LENGTH = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/**
 * Übersetzt PostgreSQL-Fehler in Meldungen, mit denen ein Admin etwas anfangen kann
 * (statt pauschal "Serverfehler"). Details landen zusätzlich im Server-Log.
 */
function describeDbError(err: any): { status: number; error: string } {
  switch (err?.code) {
    case '23505':
      return { status: 409, error: 'Diese E-Mail-Adresse ist bereits registriert (ggf. in einer anderen Firma).' };
    case '23514':
      return { status: 400, error: `Ungültiger Wert (${err.constraint_name ?? 'Prüfregel'}).` };
    case '23503':
      return { status: 400, error: 'Firma wurde in der Datenbank nicht gefunden. Bitte neu anmelden.' };
    case '42703':
    case '42P01':
      return { status: 500, error: `Datenbank ist nicht aktuell (${err.message}). Bitte Migrationen ausführen.` };
    case '42501':
      return { status: 500, error: 'Dem Datenbank-Benutzer fehlen Rechte (npm run db:fix-permissions ausführen).' };
    default:
      return { status: 500, error: 'Serverfehler beim Anlegen des Kontos. Details im Server-Log [provision-user].' };
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return bad('Sitzung abgelaufen. Bitte neu anmelden.', 401);
  }
  if (!hasPermission(session, 'users.create')) {
    return bad('Keine Berechtigung zum Anlegen von Mitarbeitern.', 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad('Ungültige Anfrage.');
  }

  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  const role = String(body.role ?? 'WORKER').toUpperCase();
  const companyId = session.companyId;

  if (!name || !email || !password) return bad('Name, E-Mail und Passwort sind erforderlich.');
  if (!EMAIL_RE.test(email)) return bad('Bitte eine gültige E-Mail-Adresse eingeben.');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return bad(`Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`);
  }
  if (!ALLOWED_ROLES.includes(role as any)) return bad('Ungültige Rolle.');
  if (role === 'ADMIN' && !isAdminLike(session)) {
    return bad('Nur Administratoren dürfen Admin-Konten erstellen.', 403);
  }

  const contractType = String(body.contractType ?? 'VOLLZEIT').toUpperCase();
  if (!CONTRACT_TYPES.includes(contractType as any)) return bad('Ungültige Vertragsart.');

  const hourlyRate = body.hourlyRate == null || body.hourlyRate === '' ? 15 : Number(body.hourlyRate);
  if (!Number.isFinite(hourlyRate) || hourlyRate < 0 || hourlyRate > 1000) return bad('Ungültiger Stundenlohn.');

  const taxClass = body.taxClass == null || body.taxClass === '' ? 1 : Number(body.taxClass);
  if (!Number.isInteger(taxClass) || taxClass < 1 || taxClass > 6) return bad('Steuerklasse muss zwischen 1 und 6 liegen.');

  const kinder = body.kinder == null || body.kinder === '' ? 0 : Number(body.kinder);
  if (!Number.isFinite(kinder) || kinder < 0 || kinder > 20) return bad('Ungültige Anzahl Kinderfreibeträge.');

  const monthlyTargetHours = body.monthlyTargetHours == null || body.monthlyTargetHours === ''
    ? null
    : Math.round(Number(body.monthlyTargetHours));
  if (monthlyTargetHours != null && (!Number.isFinite(monthlyTargetHours) || monthlyTargetHours < 0)) {
    return bad('Ungültige Soll-Stunden.');
  }

  const hasChurchTax = body.hasChurchTax === true;
  const bundesland = optionalText(body.bundesland)?.toUpperCase() ?? 'ST';
  const svNr = optionalText(body.svNr);
  const steuerId = optionalText(body.steuerId);
  const statusTaetigkeit = optionalText(body.statusTaetigkeit);

  try {
    // E-Mails sind systemweit eindeutig; Groß-/Kleinschreibung darf keine Dubletten erzeugen.
    const [existing] = await sql`
      SELECT id FROM public.users WHERE lower(email) = ${email} LIMIT 1
    `;
    if (existing) {
      return bad('Diese E-Mail-Adresse ist bereits registriert (ggf. in einer anderen Firma).', 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [user] = await sql`
      INSERT INTO public.users (
        company_id, name, email, password_hash, role,
        contract_type, hourly_rate, monthly_target_hours,
        tax_class, kinder, has_church_tax, bundesland,
        sv_nr, steuer_id, status_taetigkeit
      ) VALUES (
        ${companyId}, ${name}, ${email}, ${passwordHash}, ${role},
        ${contractType}, ${hourlyRate}, ${monthlyTargetHours},
        ${taxClass}, ${kinder}, ${hasChurchTax}, ${bundesland},
        ${svNr}, ${steuerId}, ${statusTaetigkeit}
      )
      RETURNING id, name, email, role, company_id
    `;

    // kv_zusatz_rate kommt erst mit Migration 010 – fehlt die Spalte, darf das Anlegen nicht scheitern.
    if (body.kvZusatzRate != null && body.kvZusatzRate !== '') {
      const kvZusatzRate = Number(body.kvZusatzRate);
      if (Number.isFinite(kvZusatzRate) && kvZusatzRate >= 0 && kvZusatzRate <= 10) {
        try {
          await sql`UPDATE public.users SET kv_zusatz_rate = ${kvZusatzRate} WHERE id = ${user.id}`;
        } catch (error) {
          console.warn('[provision-user] kv_zusatz_rate not saved', error);
        }
      }
    }

    await writeAuditLog({
      session,
      action: 'user.created',
      entityType: 'users',
      entityId: user.id,
      newValue: { id: user.id, email: user.email, role: user.role, contractType, hourlyRate },
      ipAddress: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return NextResponse.json({ userId: user.id }, { status: 201 });
  } catch (err: any) {
    console.error('[provision-user]', err?.code, err?.message ?? err);
    const { status, error } = describeDbError(err);
    return bad(error, status);
  }
}
