import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { getSession } from '@/lib/auth-server';
import { hasPermission, isAdminLike } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { getRequestIp, getUserAgent } from '@/lib/request-context';

const ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER'] as const;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'users.create')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  try {
    const { email, password, name, role, contractType, hourlyRate, monthlyTargetHours } = await req.json();
    const requestedRole = String(role ?? 'WORKER').toUpperCase();
    const companyId = session.companyId;

    if (!email || !password || !name || !requestedRole) {
      return NextResponse.json({ error: 'Pflichtfelder fehlen' }, { status: 400 });
    }

    if (String(password).length < 12) {
      return NextResponse.json({ error: 'Passwort muss mindestens 12 Zeichen haben' }, { status: 400 });
    }

    if (!ALLOWED_ROLES.includes(requestedRole as any)) {
      return NextResponse.json({ error: 'Ungültige Rolle' }, { status: 400 });
    }

    if (requestedRole === 'ADMIN' && !isAdminLike(session)) {
      return NextResponse.json({ error: 'Nur Administratoren dürfen Admin-Konten erstellen' }, { status: 403 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [user] = await sql`
      INSERT INTO public.users (
        company_id, name, email, password_hash, role,
        contract_type, hourly_rate, monthly_target_hours,
        tax_class, kinder, has_church_tax, bundesland
      ) VALUES (
        ${companyId}, ${String(name).trim()}, ${String(email).toLowerCase().trim()}, ${passwordHash}, ${requestedRole},
        ${contractType ?? 'MINIJOB'}, ${hourlyRate ?? 15}, ${monthlyTargetHours ?? null},
        1, 0, false, 'ST'
      )
      RETURNING id, name, email, role, company_id
    `;

    await writeAuditLog({
      session,
      action: 'user.created',
      entityType: 'users',
      entityId: user.id,
      newValue: { id: user.id, email: user.email, role: user.role },
      ipAddress: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return NextResponse.json({ userId: user.id }, { status: 201 });
  } catch (err: any) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'E-Mail bereits vergeben' }, { status: 409 });
    }
    console.error('[provision-user]', err);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
