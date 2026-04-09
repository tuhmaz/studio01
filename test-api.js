import sql from './src/lib/db.js';

async function test() {
  try {
    const companyId = 'tuhmaz-pro-2026';
    const today = '2026-04-09';
    const workerId = '12345678-1234-1234-1234-123456789012';

    let query = sql`
      SELECT * FROM job_assignments 
      WHERE company_id = ${companyId} 
      AND is_plan_published = true 
      AND (
        scheduled_date = ${today} 
        OR (scheduled_date < ${today} AND status != 'COMPLETED')
      )
    `;

    if (workerId) {
      query = sql`${query} AND assigned_worker_ids @> ${sql.array([workerId])}`;
    }

    const rows = await query;
    console.log('Query success:', rows);
  } catch (err) {
    console.error('Query error:', err);
  } finally {
    process.exit(0);
  }
}

test();
