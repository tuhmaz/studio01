'use client';

/**
 * E-Mail-Versand: Status der SMTP-Konfiguration (Umgebungsvariablen des
 * Servers, nicht in der Datenbank) und Testmail an die eigene Adresse.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Mail, Send, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Status { enabled: boolean; smtpConfigured: boolean; host: string | null; from: string | null; appUrl: string | null }

export function MailSettingsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [test, setTest] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false });

  useEffect(() => {
    fetch('/api/settings/mail').then(r => (r.ok ? r.json() : null)).then(j => setStatus(j?.data ?? null)).catch(() => setStatus(null));
  }, []);

  const sendTest = async () => {
    setTest({ busy: true });
    try {
      const res = await fetch('/api/settings/mail', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error);
      setTest({ busy: false, ok: true, text: `Testmail an ${json.data.to} gesendet. Bitte Posteingang (und Spam) prüfen.` });
    } catch (e: any) {
      setTest({ busy: false, ok: false, text: e?.message || 'Versand fehlgeschlagen' });
    }
  };

  if (!status) return null;
  const problems = [
    !status.smtpConfigured && 'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS und MAIL_FROM',
    !status.appUrl && 'NEXT_PUBLIC_APP_URL (Adresse dieser Installation, z. B. https://app.firma.de)',
  ].filter(Boolean) as string[];

  return (
    <Card className="rounded-3xl border-none shadow-lg">
      <CardContent className="p-8 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-primary/10"><Mail className="w-5 h-5 text-primary" /></div>
          <div className="flex-1">
            <p className="font-black text-lg">E-Mail-Versand</p>
            <p className="text-sm text-muted-foreground">Für Einladungen, „Passwort vergessen“ und die Bestätigung von E-Mail-Adressen. Absender ist das eigene Postfach (SMTP).</p>
          </div>
          {status.enabled && status.smtpConfigured
            ? <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700"><CheckCircle2 className="w-4 h-4" />Eingerichtet</span>
            : <span className="flex items-center gap-1.5 text-sm font-bold text-amber-700"><XCircle className="w-4 h-4" />Nicht eingerichtet</span>}
        </div>

        {status.smtpConfigured && (
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
            <dt className="text-muted-foreground">Server</dt><dd className="font-mono">{status.host}</dd>
            <dt className="text-muted-foreground">Absender</dt><dd>{status.from}</dd>
            <dt className="text-muted-foreground">Links auf</dt><dd>{status.appUrl ?? '—'}</dd>
          </dl>
        )}

        {problems.length > 0 && (
          <p className="text-sm text-amber-900 bg-amber-50 rounded-xl p-3">
            Auf dem Server fehlen die Umgebungsvariablen: {problems.join('; ')}. Danach die App neu starten.
            {!status.smtpConfigured && status.enabled && ' (Entwicklung: Mails erscheinen nur im Server-Log.)'}
          </p>
        )}

        {status.enabled && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" className="rounded-xl gap-2" onClick={sendTest} disabled={test.busy}>
              {test.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Testmail an mich senden
            </Button>
            {test.text && <span className={`text-sm ${test.ok ? 'text-emerald-700' : 'text-destructive'}`}>{test.text}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
