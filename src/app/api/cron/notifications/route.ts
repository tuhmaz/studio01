/**
 * GET /api/cron/notifications — alle 5 Minuten vom Crontab des Servers:
 *
 *   (alle 5 Min., z. B. "0-59/5 * * * *")  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/notifications
 *
 *  1. Erinnerung an offene Zeiteinträge (> NOTIFY_OPEN_SHIFT_HOURS, Standard 10 h).
 *  2. Push nachholen, der direkt nach dem Speichern nicht verschickt werden konnte.
 * Disabled (503) unless CRON_SECRET is set.
 */
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { remindOpenShifts } from '@/lib/shift-reminders';
import { deliverPendingPush } from '@/lib/notifications';

function authorized(req: NextRequest, secret: string) {
  const given = Buffer.from(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: 'CRON_SECRET ist nicht gesetzt' }, { status: 503 });
  }
  if (!authorized(req, secret)) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });

  const reminders = await remindOpenShifts();
  const push = await deliverPendingPush();
  return NextResponse.json({ reminders, push });
}
