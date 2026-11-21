/**
 * GET /api/settings/overview — what the settings page shows besides the
 * editable company fields:
 *  - setup:    onboarding checklist for this company
 *  - travel:   headquarters and remote-site rule
 *  - media:    stored photos/voice notes, and how many still sit in the DB
 *  - platform: storage driver and database migrations (SUPER_ADMIN only;
 *              this is server operation, not company data)
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import sql, { withTenant } from '@/lib/db';
import { hasPermission, normalizeRole } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';

async function migrationStatus() {
  try {
    const files = (await readdir(join(process.cwd(), 'db', 'migrations')))
      .filter(name => /^\d{4}_[\w-]+\.sql$/.test(name))
      .map(name => name.replace(/\.sql$/, ''))
      .sort();
    const applied = (await sql`SELECT version FROM public.schema_migrations ORDER BY version`).map(r => r.version as string);
    return {
      applied: applied.length,
      latest: applied.at(-1) ?? null,
      pending: files.filter(f => !applied.includes(f)),
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'settings.manage')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const { companyId } = session;
  const result = await withTenant(companyId, async db => {
    const [company] = await db`
      SELECT name, address, city, hq_lat, hq_lng, remote_threshold_km, remote_bonus_minutes
        FROM companies WHERE id = ${companyId}
    `;
    const [counts] = await db`
      SELECT
        (SELECT count(*) FROM job_sites WHERE company_id = ${companyId})::int AS job_sites,
        (SELECT count(*) FROM job_sites WHERE company_id = ${companyId} AND (lat IS NULL OR lng IS NULL))::int AS sites_without_coordinates,
        (SELECT count(*) FROM users WHERE company_id = ${companyId} AND role IN ('WORKER', 'LEADER'))::int AS workers,
        (SELECT count(*) FROM job_assignments WHERE company_id = ${companyId} AND is_plan_published)::int AS published_assignments,
        (SELECT count(*) FROM media_files WHERE company_id = ${companyId})::int AS media_files,
        (SELECT coalesce(sum(size_bytes), 0) FROM media_files WHERE company_id = ${companyId})::bigint AS media_bytes,
        (SELECT count(*) FROM work_log_entries
          WHERE company_id = ${companyId} AND type IN ('photo', 'voice') AND content LIKE 'data:%')::int AS inline_media
    `;
    return { company, counts };
  });

  const { company, counts } = result;
  const hqLocated = company?.hq_lat != null && company?.hq_lng != null;

  return NextResponse.json({
    setup: {
      companyProfile: Boolean(company?.name && company?.address && company?.city),
      hqLocated,
      jobSites: counts.job_sites,
      sitesWithoutCoordinates: counts.sites_without_coordinates,
      workers: counts.workers,
      publishedAssignments: counts.published_assignments,
    },
    travel: {
      hqLat: hqLocated ? Number(company.hq_lat) : null,
      hqLng: hqLocated ? Number(company.hq_lng) : null,
      remoteThresholdKm: Number(company?.remote_threshold_km ?? 95),
      remoteBonusMinutes: Number(company?.remote_bonus_minutes ?? 60),
    },
    media: {
      files: counts.media_files,
      bytes: Number(counts.media_bytes),
      inlineLegacy: counts.inline_media,
    },
    platform: normalizeRole(session.role) === 'SUPER_ADMIN'
      ? {
          storageDriver: (process.env.STORAGE_DRIVER || 'local').toLowerCase(),
          migrations: await migrationStatus(),
        }
      : null,
  });
}
