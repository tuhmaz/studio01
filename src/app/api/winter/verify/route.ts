/**
 * GET /api/winter/verify — recomputes the company's Winterdienst hash chain.
 * { valid, entries, brokenAt } — brokenAt is the first entry that no longer
 * matches what was recorded. Requires winter.manage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { verifyWinterChain } from '@/lib/winter';
import { errorResponse } from '@/lib/winter-api';

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'winter.manage')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }
  try {
    const result = await withTenant(session.companyId, db => verifyWinterChain(db, session.companyId));
    return NextResponse.json({ ...result, checkedAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error, 'winter/verify');
  }
}
