/** Excel/CSV-Import: Prüfung (Vorschau), Anlegen, Duplikate, Rechte. */
import { beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { POST as importApi } from '@/app/api/import/route';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => { fx = await seed(); });

const run = async (role: Parameters<typeof tokenFor>[1], body: Record<string, unknown>, company: 'a' | 'b' = 'a') =>
  call(importApi, '/api/import', await tokenFor(company === 'a' ? fx.a : fx.b, role), body);

describe('Objekte', () => {
  const rows = [
    { name: 'Lindenhof', address: 'Lindenstr. 4', postalCode: '39104', city: 'Magdeburg', client: 'HV Nord',
      services: 'Hofbereich, Rasen Fl. 1, Treppenhaus reinigen', months: 'Apr-Okt', winter: 'ja' },
    { address: 'Parkweg 2', city: 'Halle', services: 'Gullis', region: 'T2' },
    { address: 'lindenstr. 4', city: 'magdeburg' },
    { address: 'Ohne Ort' },
    { address: 'Bahnhofstr. 1', city: 'Burg', postalCode: '123' },
    { address: 'Am Markt 1', city: 'Burg', months: 'Sommer' },
  ];

  it('Vorschau prüft, ohne etwas anzulegen', async () => {
    const res = await run('MANAGER', { type: 'sites', rows, dryRun: true });
    expect(res.status).toBe(200);
    const r = res.json.data;
    expect(r.counts).toEqual({ new: 2, skip: 1, error: 3 });
    expect(r.rows.map((x: any) => x.status)).toEqual(['new', 'new', 'skip', 'error', 'error', 'error']);
    expect(r.rows[0].messages).toEqual(expect.arrayContaining(['Eigene Leistung: Treppenhaus reinigen', 'Hausverwaltung „HV Nord“ wird angelegt']));
    expect(r.rows[2].messages[0]).toMatch(/Doppelt in der Datei \(wie Zeile 2\)/);
    expect(r.rows[3].messages).toContain('Ort fehlt');
    expect(r.created).toBe(0);
    expect(await sql`SELECT 1 FROM job_sites WHERE city IN ('Magdeburg','Halle')`).toHaveLength(0);
  });

  it('legt an: Leistungen mit Monaten, Hausverwaltung, Winterdienst, freie IDs', async () => {
    await sql`INSERT INTO job_sites (id, company_id, name, address, city) VALUES ('0007', 'co-b', 'Fremd', 'X', 'Y')`;
    await sql`UPDATE job_sites SET id = '0006' WHERE id = ${fx.a.jobSiteId}`.catch(() => undefined);
    const res = await run('ADMIN', { type: 'sites', rows: rows.slice(0, 2), dryRun: false });
    expect(res.json.data.created).toBe(2);
    const ids = res.json.data.createdSiteIds as string[];
    expect(ids).not.toContain('0007');
    const [site] = await sql`
      SELECT s.*, c.name AS client_name FROM job_sites s LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = ${ids[0]}
    `;
    expect(site).toMatchObject({ company_id: 'co-a', name: 'Lindenhof', postal_code: '39104', winter_service_enabled: true, client_name: 'HV Nord' });
    expect(Object.keys(site.services).sort()).toEqual(['AR_Hof', 'Rasen_Fl1', 'custom_treppenhaus_reinigen']);
    expect(site.services.AR_Hof.months).toEqual(['Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.']);
    expect(site.services.custom_treppenhaus_reinigen.label).toBe('Treppenhaus reinigen');
    const [second] = await sql`SELECT services, route_code FROM job_sites WHERE id = ${ids[1]}`;
    expect(second.services.Gullis.months).toHaveLength(12);
    expect(second.route_code).toBe('T2');

    // Nochmals → alles übersprungen, nichts doppelt.
    const again = await run('ADMIN', { type: 'sites', rows: rows.slice(0, 2), dryRun: false });
    expect(again.json.data.counts).toEqual({ new: 0, skip: 2, error: 0 });
    expect(await sql`SELECT 1 FROM clients WHERE name = 'HV Nord'`).toHaveLength(1);
  });

  it('nur mit Objekt-Rechten', async () => {
    expect((await run('WORKER', { type: 'sites', rows, dryRun: true })).status).toBe(403);
    expect((await run('MANAGER', { type: 'sites', rows: [], dryRun: true })).status).toBe(400);
    expect((await run('MANAGER', { type: 'x', rows })).status).toBe(400);
  });
});

describe('Mitarbeiter', () => {
  const rows = [
    { firstName: 'Ayşe', lastName: 'Demir', email: 'Ayse.Demir@Firma.test', role: 'Teamleiter', contractType: 'Minijob', hourlyRate: '13,50 €', monthlyTargetHours: '40' },
    { name: 'Piotr Nowak', email: 'piotr@firma.test' },
    { name: 'Doppelt', email: 'ayse.demir@firma.test' },
    { name: 'Schon da', email: (f: Fixtures) => f.a.users.WORKER.email },
    { name: 'Kein Mail' },
    { name: 'Chef', email: 'chef@firma.test', role: 'Admin' },
    { name: 'Komisch', email: 'k@firma.test', role: 'Pilot', taxClass: '9' },
  ];
  const resolved = () => rows.map(r => ({ ...r, email: typeof r.email === 'function' ? r.email(fx) : r.email }));

  it('Vorschau: Duplikate, vorhandene E-Mail, unbekannte Werte', async () => {
    const res = await run('ADMIN', { type: 'users', rows: resolved(), dryRun: true });
    expect(res.json.data.rows.map((r: any) => r.status)).toEqual(['new', 'new', 'skip', 'skip', 'error', 'new', 'error']);
    expect(res.json.data.rows[0].messages[0]).toBe('Teamleiter · Minijob · 13,5 €/h');
    expect(res.json.data.rows[5].messages[0]).toMatch(/^Admin/);
    expect(res.json.data.rows[6].messages).toEqual(expect.arrayContaining(['Rolle „Pilot“ unbekannt', 'Steuerklasse „9“ muss 1–6 sein']));
    expect(res.json.data.credentials).toBeUndefined();
  });

  it('legt Konten an, Startpasswort funktioniert und steht nur in der Antwort', async () => {
    const res = await run('ADMIN', { type: 'users', rows: resolved().slice(0, 2), dryRun: false });
    expect(res.json.data.created).toBe(2);
    const creds = res.json.data.credentials;
    expect(creds.map((c: any) => c.email)).toEqual(['ayse.demir@firma.test', 'piotr@firma.test']);
    const [u] = await sql`SELECT * FROM users WHERE email = 'ayse.demir@firma.test'`;
    expect(u).toMatchObject({ company_id: 'co-a', name: 'Ayşe Demir', role: 'LEADER', contract_type: 'MINIJOB', monthly_target_hours: 40 });
    expect(Number(u.hourly_rate)).toBe(13.5);
    expect(creds[0].password).toMatch(/^[A-Za-z2-9]{14}$/);
    expect(await bcrypt.compare(creds[0].password, u.password_hash)).toBe(true);
    const audit = await sql`SELECT new_value FROM audit_logs WHERE action = 'users.imported'`;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].new_value)).not.toContain(creds[0].password);
  });

  it('E-Mail einer anderen Firma wird nicht übernommen; Rechte', async () => {
    const res = await run('ADMIN', { type: 'users', rows: [{ name: 'X', email: fx.b.users.WORKER.email }], dryRun: false }, 'a');
    expect(res.json.data.counts.skip).toBe(1);
    expect((await run('LEADER', { type: 'users', rows: [{ name: 'X', email: 'x@y.test' }] })).status).toBe(403);
    expect((await run('MANAGER', { type: 'users', rows: [{ name: 'X', email: 'x@y.test' }] })).status).toBe(403);
  });
});
