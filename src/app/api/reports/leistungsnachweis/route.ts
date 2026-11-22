/**
 * GET /api/reports/leistungsnachweis?siteId=…&month=YYYY-MM | YYYY (ganzes Jahr)
 *
 * Monthly proof of service for one site (see src/lib/leistungsnachweis.ts).
 * Internal view: always with worker names. Requires reports.export.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { buildLeistungsnachweis } from '@/lib/leistungsnachweis';
import { periodRange } from '@/lib/leistungsnachweis-types';

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'reports.export')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });

  const siteId = req.nextUrl.searchParams.get('siteId');
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!siteId || !periodRange(month)) return NextResponse.json({ error: 'siteId und month (YYYY-MM oder YYYY) erforderlich' }, { status: 400 });

  try {
    const report = await withTenant(session.companyId, db => buildLeistungsnachweis(db, session.companyId, siteId, month, {
      showWorkerNames: true,
      mediaUrl: id => `/api/media/${id}`,
    }));
    if (!report) return NextResponse.json({ error: 'Objekt nicht gefunden' }, { status: 404 });
    return NextResponse.json(report);
  } catch (error) {
    console.error('[reports/leistungsnachweis]', error);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
