import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function GET(req: NextRequest) {
  const secret = process.env.HEALTHCHECK_SECRET;
  const requestedDetails = req.nextUrl.searchParams.get('details') === '1';
  const providedSecret = req.headers.get('x-health-secret');
  const canShowDetails = Boolean(secret && providedSecret && providedSecret === secret);

  if (!requestedDetails || !canShowDetails) {
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  const info: Record<string, any> = {
    node_env: process.env.NODE_ENV,
    db_status: 'pending',
    migrations: {
      audit_logs: false,
    },
    db_error: null,
  };

  try {
    await sql`SELECT 1 AS ok`;
    const auditTable = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'audit_logs'
      LIMIT 1
    `;
    info.migrations.audit_logs = auditTable.length > 0;
    info.db_status = 'connected';
  } catch (err: any) {
    info.db_status = 'failed';
    info.db_error = err?.message ?? String(err);
  }

  return NextResponse.json(info, { status: 200 });
}
