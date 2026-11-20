/**
 * GET /api/portal/leistungsnachweis?siteId=…&month=YYYY-MM
 * Leistungsnachweis für ein Objekt der eigenen Hausverwaltung.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { buildLeistungsnachweis } from '@/lib/leistungsnachweis';
import { monthRange } from '@/lib/leistungsnachweis-types';
import {
  PortalError,
  portalErrorResponse,
  portalMediaUrl,
  portalShowsWorkerNames,
  portalSite,
  requirePortalSession,
} from '@/lib/portal';

export async function GET(req: NextRequest) {
  const session = await requirePortalSession(req);
  if (session instanceof NextResponse) return session;

  const siteId = req.nextUrl.searchParams.get('siteId');
  const month = req.nextUrl.searchParams.get('month') ?? '';

  try {
    if (!monthRange(month)) throw new PortalError('month (YYYY-MM) erforderlich');
    const report = await withTenant(session.companyId, async db => {
      await portalSite(db, session, siteId);
      return buildLeistungsnachweis(db, session.companyId, siteId as string, month, {
        showWorkerNames: await portalShowsWorkerNames(db, session.companyId),
        mediaUrl: portalMediaUrl,
      });
    });
    if (!report) throw new PortalError('Objekt nicht gefunden', 404);
    return NextResponse.json(report);
  } catch (error) {
    return portalErrorResponse(error, 'portal/leistungsnachweis');
  }
}
