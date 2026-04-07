import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { getSession } from '@/lib/auth-server';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  try {
    const { email, password, name, role, companyId, contractType, hourlyRate, monthlyTargetHours } = await req.json();

    if (!email || !password || !name || !role || !companyId) {
      return NextResponse.json({ error: 'Pflichtfelder fehlen' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [user] = await sql`
      INSERT INTO public.users (
        company_id, name, email, password_hash, role,
        contract_type, hourly_rate, monthly_target_hours,
        tax_class, kinder, has_church_tax, bundesland
      ) VALUES (
        ${companyId}, ${name}, ${email.toLowerCase().trim()}, ${passwordHash}, ${role},
        ${contractType ?? 'MINIJOB'}, ${hourlyRate ?? 15}, ${monthlyTargetHours ?? null},
        1, 0, false, 'ST'
      )
      RETURNING id
    `;

    return NextResponse.json({ userId: user.id }, { status: 201 });
  } catch (err: any) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'E-Mail bereits vergeben' }, { status: 409 });
    }
    console.error('[provision-user]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
