/**
 * Moves photos and voice notes that are still stored as Base64 data URLs in
 * work_log_entries.content into file storage (same storage the app uses).
 *
 *   npm run media:migrate -- --dry-run     # count only, change nothing
 *   npm run media:migrate                  # migrate everything
 *   npm run media:migrate -- --limit 100   # migrate at most 100 entries
 *
 * Safe to stop and re-run: each entry is handled in its own transaction and
 * only rows whose content still starts with "data:" are touched. Entries whose
 * data cannot be validated are reported and left unchanged.
 *
 * Run `VACUUM FULL public.work_log_entries` afterwards (during a quiet hour;
 * it locks the table) to give the freed space back to the operating system.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';

for (const file of ['.env.production', '.env']) {
  const path = join(process.cwd(), file);
  if (existsSync(path)) {
    dotenv.config({ path });
    break;
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
const BATCH = 20;

async function main() {
  const { default: sql, withTenant } = await import('../src/lib/db');
  const { storeDataUrl, MediaError } = await import('../src/lib/media');
  const { getStorage } = await import('../src/lib/storage');

  const [{ count, bytes }] = await sql`
    SELECT count(*)::int AS count, coalesce(sum(length(content)), 0)::bigint AS bytes
      FROM work_log_entries
     WHERE type IN ('photo', 'voice') AND content LIKE 'data:%'
  `;
  console.log(`${count} entries with inline media (${(Number(bytes) / 1024 / 1024).toFixed(1)} MB of Base64). Storage: ${getStorage().name}.`);
  if (dryRun || !count) {
    await sql.end();
    return;
  }

  let done = 0;
  let failed = 0;
  let lastId = '';
  while (done + failed < Math.min(count, limit)) {
    // Ids only first: the Base64 payloads are loaded one at a time below.
    const batch = await sql`
      SELECT id, company_id, employee_id, type
        FROM work_log_entries
       WHERE type IN ('photo', 'voice') AND content LIKE 'data:%' AND id > ${lastId}
       ORDER BY id
       LIMIT ${BATCH}
    `;
    if (!batch.length) break;

    for (const row of batch) {
      lastId = row.id;
      if (done + failed >= limit) break;
      try {
        await withTenant(row.company_id, async tx => {
          const [current] = await tx`
            SELECT content FROM work_log_entries
             WHERE id = ${row.id} AND content LIKE 'data:%'
             FOR UPDATE
          `;
          if (!current) return;
          const url = await storeDataUrl(tx, {
            companyId: row.company_id,
            userId: row.employee_id,
            kind: row.type,
            dataUrl: current.content,
          });
          await tx`UPDATE work_log_entries SET content = ${url} WHERE id = ${row.id}`;
        });
        done += 1;
      } catch (error) {
        failed += 1;
        const reason = error instanceof MediaError ? error.message : (error as Error).message;
        console.warn(`  skipped ${row.id}: ${reason}`);
      }
    }
    process.stdout.write(`\r  migrated ${done}, skipped ${failed}`);
  }

  console.log(`\nDone: ${done} migrated, ${failed} skipped.`);
  await sql.end();
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
});
