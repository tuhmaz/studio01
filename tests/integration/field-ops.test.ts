/**
 * Offline-fähige Arbeitsvorgänge der App (/api/field/ops, /api/checks mit checkedAt):
 * Team-Einstempeln, verspätet gesendete Zeitpunkte, Wiederholungen, Rechte.
 */
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as ops } from '@/app/api/field/ops/route';
import { POST as check } from '@/app/api/checks/route';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('field photo bytes')]).toString('base64')}`;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
/** Wie der Server: auf 5 Minuten gerundet. */
const round5 = (d: Date) => new Date(Math.round(d.getTime() / 300_000) * 300_000).toISOString();

beforeEach(async () => {
  fx = await seed();
  await sql`DELETE FROM work_log_entries`;
  await sql`DELETE FROM time_entries`;
  // Zweier-Team für den Einsatz von Firma A.
  await sql`UPDATE job_assignments SET assigned_worker_ids = ${sql.array([fx.a.users.WORKER.id, fx.a.users.LEADER.id])}, status = 'PENDING' WHERE id = 'job-a'`;
});

const run = async (role: 'WORKER' | 'LEADER' | 'ACCOUNTANT' | 'ADMIN', body: Record<string, unknown>, f = () => fx.a) =>
  call(ops, '/api/field/ops', await tokenFor(f(), role), body);

describe('Einstempeln', () => {
  it('stempelt das ganze Team mit richtigem Mitarbeiter ein – auch wenn ein Mitarbeiter es auslöst', async () => {
    const at = hoursAgo(2);
    const res = await run('WORKER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0001', at: at.toISOString(), lat: 51.5, lng: 11.9, gpsVerified: true });
    expect(res.status).toBe(200);
    expect(res.json.data.ownEntryId).toBe('te-req-in-0001');

    const entries = await sql`SELECT id, employee_id, status, clock_in_datetime, gps_verified FROM time_entries ORDER BY id`;
    expect(entries.map(e => e.employee_id).sort()).toEqual([fx.a.users.WORKER.id, fx.a.users.LEADER.id].sort());
    expect(entries.every(e => e.status === 'OPEN')).toBe(true);
    // Zeitpunkt vom Gerät, nicht der Empfangszeit.
    expect(new Date(entries[0].clock_in_datetime).toISOString()).toBe(round5(at));
    expect(entries.find(e => e.id === 'te-req-in-0001')?.gps_verified).toBe(true);
    expect((await sql`SELECT status FROM job_assignments WHERE id = 'job-a'`)[0].status).toBe('IN_PROGRESS');
  });

  it('ist bei Wiederholung idempotent – auch nach dem Ausstempeln', async () => {
    const body = { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0002' };
    await run('WORKER', body);
    await run('WORKER', body);
    expect((await sql`SELECT count(*)::int AS n FROM time_entries`)[0].n).toBe(2);
    await run('WORKER', { op: 'clock_out', assignmentId: 'job-a', requestId: 'req-out-0002' });
    const again = await run('WORKER', body);
    expect(again.status).toBe(200);
    expect((await sql`SELECT count(*)::int AS n FROM time_entries WHERE status = 'OPEN'`)[0].n).toBe(0);
  });

  it('lehnt Zeitpunkte älter als 72 h und in der Zukunft ab', async () => {
    expect((await run('WORKER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0003', at: hoursAgo(73).toISOString() })).status).toBe(400);
    expect((await run('WORKER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0004', at: hoursAgo(-1).toISOString() })).status).toBe(400);
    expect((await sql`SELECT count(*)::int AS n FROM time_entries`)[0].n).toBe(0);
  });

  it('nur eigene Einsätze, nur eigene Firma, kein Buchhalter', async () => {
    await sql`UPDATE job_assignments SET assigned_worker_ids = ${sql.array([fx.a.users.LEADER.id])} WHERE id = 'job-a'`;
    expect((await run('WORKER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0005' })).status).toBe(404);
    expect((await run('WORKER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0006' }, () => fx.b)).status).toBe(404);
    expect((await run('ACCOUNTANT', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0007' })).status).toBe(403);
    // Leitung darf auch fremde Einsätze (z. B. für das Team) stempeln.
    expect((await run('LEADER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0008' })).status).toBe(200);
  });
});

describe('Ausstempeln', () => {
  it('rechnet die Minuten auf dem Server aus den Gerätezeiten und schließt den Einsatz', async () => {
    await run('WORKER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0010', at: hoursAgo(5).toISOString() });
    const out = await run('WORKER', { op: 'clock_out', assignmentId: 'job-a', requestId: 'req-out-0010', at: hoursAgo(1).toISOString(), travelBonusMinutes: -60 });
    expect(out.json.data.closed).toBe(2);
    const entries = await sql`SELECT employee_id, status, actual_work_minutes, travel_bonus_minutes, submission_datetime FROM time_entries`;
    for (const e of entries) {
      expect(e.status).toBe('SUBMITTED');
      expect(e.actual_work_minutes).toBe(240);
      expect(e.submission_datetime).not.toBeNull();
    }
    // Fahrtzeit-Ausgleich nur für den, der ausstempelt.
    expect(entries.find(e => e.employee_id === fx.a.users.WORKER.id)?.travel_bonus_minutes).toBe(-60);
    expect(entries.find(e => e.employee_id === fx.a.users.LEADER.id)?.travel_bonus_minutes).toBe(0);
    expect((await sql`SELECT status FROM job_assignments WHERE id = 'job-a'`)[0].status).toBe('COMPLETED');

    // Wiederholung ändert nichts.
    const again = await run('WORKER', { op: 'clock_out', assignmentId: 'job-a', requestId: 'req-out-0010', at: new Date().toISOString() });
    expect(again.json.data.closed).toBe(0);
    expect((await sql`SELECT actual_work_minutes FROM time_entries LIMIT 1`)[0].actual_work_minutes).toBe(240);
  });

  it('Ausstempelzeit vor dem Einstempeln ergibt 0 Minuten, nicht negativ', async () => {
    await run('WORKER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0011', at: hoursAgo(1).toISOString() });
    await run('WORKER', { op: 'clock_out', assignmentId: 'job-a', requestId: 'req-out-0011', at: hoursAgo(2).toISOString() });
    expect((await sql`SELECT actual_work_minutes FROM time_entries LIMIT 1`)[0].actual_work_minutes).toBe(0);
  });
});

describe('Notizen', () => {
  it('nimmt offline erzeugte Notizen mit Gerätezeit an, einmalig', async () => {
    await run('WORKER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0020' });
    const at = hoursAgo(0.5);
    const note = { op: 'note', id: 'note-offline-01', assignmentId: 'job-a', timeEntryId: 'te-req-in-0020', type: 'photo', content: JPEG, at: at.toISOString() };
    const first = await run('WORKER', note);
    expect(first.status).toBe(200);
    expect(first.json.data.content).toMatch(/^\/api\/media\//);
    await run('WORKER', note);
    const rows = await sql`SELECT time_entry_id, job_assignment_id, created_at FROM work_log_entries`;
    expect(rows).toHaveLength(1);
    expect(rows[0].time_entry_id).toBe('te-req-in-0020');
    expect(new Date(rows[0].created_at).toISOString()).toBe(at.toISOString());
  });

  it('findet den Zeiteintrag, wenn die offline-ID nicht passt; ohne Einstempeln 409', async () => {
    expect((await run('WORKER', { op: 'note', id: 'note-offline-02', assignmentId: 'job-a', type: 'text', content: 'x' })).status).toBe(409);
    // Ein Kollege hat das Team eingestempelt → eigener Eintrag hat seine ID.
    await run('LEADER', { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-in-0021' });
    const res = await run('WORKER', { op: 'note', id: 'note-offline-03', assignmentId: 'job-a', timeEntryId: 'te-unknown', type: 'text', content: 'Tor klemmt' });
    expect(res.status).toBe(200);
    const [row] = await sql`SELECT t.employee_id FROM work_log_entries w JOIN time_entries t ON t.id = w.time_entry_id`;
    expect(row.employee_id).toBe(fx.a.users.WORKER.id);
  });
});

describe('Checkliste mit Gerätezeit', () => {
  it('übernimmt checkedAt und lehnt Zeiten älter als 72 h ab', async () => {
    await sql`UPDATE job_sites SET services = ${sql.json({ Gullis: { isActive: true, months: ['Nov.'] } })} WHERE id = ${fx.a.jobSiteId}`;
    await sql`UPDATE job_assignments SET categories = ${sql.array(['Gullis'])} WHERE id = 'job-a'`;
    const worker = await tokenFor(fx.a, 'WORKER');
    const at = hoursAgo(3);
    expect((await call(check, '/api/checks', worker, { assignmentId: 'job-a', serviceCode: 'Gullis', status: 'done', checkedAt: at.toISOString() })).status).toBe(200);
    expect(new Date((await sql`SELECT checked_at FROM service_checks`)[0].checked_at).toISOString()).toBe(at.toISOString());
    // Späteres Vorher-Foto verschiebt die Erledigungszeit nicht.
    await call(check, '/api/checks', worker, { assignmentId: 'job-a', serviceCode: 'Gullis', status: 'started', beforePhoto: JPEG });
    expect(new Date((await sql`SELECT checked_at FROM service_checks`)[0].checked_at).toISOString()).toBe(at.toISOString());
    expect((await call(check, '/api/checks', worker, { assignmentId: 'job-a', serviceCode: 'Gullis', status: 'done', checkedAt: hoursAgo(80).toISOString() })).status).toBe(400);
  });
});

describe('Ein ganzer Tag ohne Netz', () => {
  it('abends gesendet: Zeiten, Checkliste und Notiz stimmen wie vor Ort erfasst', async () => {
    await sql`UPDATE job_sites SET services = ${sql.json({ Gullis: { isActive: true, months: ['Nov.'] } })} WHERE id = ${fx.a.jobSiteId}`;
    await sql`UPDATE job_assignments SET categories = ${sql.array(['Gullis'])}, assigned_worker_ids = ${sql.array([fx.a.users.WORKER.id])} WHERE id = 'job-a'`;
    const worker = await tokenFor(fx.a, 'WORKER');
    const t0 = hoursAgo(10);
    const t1 = new Date(t0.getTime() + 20 * 60_000);
    const t2 = new Date(t0.getTime() + 45 * 60_000);
    const t3 = new Date(t0.getTime() + 3 * 3_600_000);
    // In der Reihenfolge, in der die App den Postausgang abarbeitet.
    await call(ops, '/api/field/ops', worker, { op: 'clock_in', assignmentId: 'job-a', requestId: 'req-day-in', at: t0.toISOString() });
    await call(check, '/api/checks', worker, { assignmentId: 'job-a', serviceCode: 'Gullis', status: 'done', checkedAt: t1.toISOString() });
    await call(ops, '/api/field/ops', worker, { op: 'note', id: 'note-day-0001', assignmentId: 'job-a', timeEntryId: 'te-req-day-in', type: 'text', content: 'Gully frei', at: t2.toISOString() });
    await call(ops, '/api/field/ops', worker, { op: 'clock_out', assignmentId: 'job-a', requestId: 'req-day-out', at: t3.toISOString() });

    const [entry] = await sql`SELECT clock_in_datetime, clock_out_datetime, actual_work_minutes, status FROM time_entries`;
    expect(new Date(entry.clock_in_datetime).toISOString()).toBe(round5(t0));
    expect(new Date(entry.clock_out_datetime).toISOString()).toBe(round5(t3));
    expect(entry.actual_work_minutes).toBe(Math.round((Date.parse(round5(t3)) - Date.parse(round5(t0))) / 60000));
    expect(entry.status).toBe('SUBMITTED');
    expect(new Date((await sql`SELECT checked_at FROM service_checks`)[0].checked_at).toISOString()).toBe(t1.toISOString());
    expect(new Date((await sql`SELECT created_at FROM work_log_entries`)[0].created_at).toISOString()).toBe(t2.toISOString());
    expect((await sql`SELECT status FROM job_assignments WHERE id = 'job-a'`)[0].status).toBe('COMPLETED');
  });
});
