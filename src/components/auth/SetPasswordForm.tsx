'use client';

/**
 * Neues Passwort über einen Einmal-Link (Einladung oder „Passwort vergessen“).
 * Prüft den Link beim Laden, damit ein abgelaufener Link sofort erklärt wird.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, Lock, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/components/auth/AuthCard';

interface TokenInfo { name: string; email: string; companyName: string }

export function SetPasswordForm({ purpose }: { purpose: 'invite' | 'reset' }) {
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ role: string; email: string; next: string; signedIn: boolean } | null>(null);

  useEffect(() => {
    fetch(`/api/auth/token?purpose=${purpose}&token=${encodeURIComponent(token)}`)
      .then(async r => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error);
        setInfo(json.data);
      })
      .catch(e => setLinkError(e?.message || 'Der Link ist ungültig.'));
  }, [token, purpose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== repeat) { setError('Die Passwörter stimmen nicht überein.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/password/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error);
      setDone(json.data);
    } catch (err: any) {
      setError(err?.message || 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  const title = purpose === 'invite' ? 'Willkommen' : 'Neues Passwort';
  const isAppUser = done && (done.role === 'WORKER' || done.role === 'LEADER');

  return (
    <AuthCard
      title={title}
      subtitle={info ? (purpose === 'invite' ? `${info.name} · ${info.companyName}` : info.email) : undefined}
    >
      {linkError ? (
        <div className="text-center space-y-4 py-4">
          <p className="font-bold">{linkError}</p>
          {purpose === 'reset'
            ? <Link href="/passwort-vergessen" className="inline-block text-sm font-bold text-primary hover:underline">Neuen Link anfordern</Link>
            : <p className="text-sm text-muted-foreground">Bitte im Büro um eine neue Einladung bitten.</p>}
        </div>
      ) : !info ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : done ? (
        <div className="text-center space-y-4 py-2">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <p className="font-bold">Passwort gespeichert.</p>
          {isAppUser ? (
            <div className="rounded-2xl bg-muted/50 p-4 text-sm text-left flex gap-3">
              <Smartphone className="w-5 h-5 shrink-0 text-primary" />
              <span>Melden Sie sich jetzt in der <b>Mitarbeiter-App</b> an:<br />E-Mail <b>{done.email}</b> und Ihr neues Passwort.</span>
            </div>
          ) : (
            <Button className="w-full h-12 font-black" onClick={() => { window.location.href = done.signedIn ? done.next : '/'; }}>
              {done.signedIn ? 'Weiter' : 'Zur Anmeldung'}
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {purpose === 'invite' && (
            <p className="text-sm text-muted-foreground">Legen Sie Ihr Passwort fest. Ihr Benutzername ist <b>{info.email}</b>.</p>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">Neues Passwort</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="password" type="password" className="pl-10 h-12" autoComplete="new-password" autoFocus
                value={password} onChange={e => setPassword(e.target.value)} required minLength={12} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="repeat">Wiederholen</Label>
            <Input id="repeat" type="password" className="h-12" autoComplete="new-password"
              value={repeat} onChange={e => setRepeat(e.target.value)} required minLength={12} />
            <p className="text-[11px] text-muted-foreground">Mindestens 12 Zeichen. Danach werden alle anderen Geräte abgemeldet.</p>
          </div>
          {error && <p className="text-sm text-destructive font-medium">{error}</p>}
          <Button type="submit" className="w-full h-12 font-black text-lg" disabled={busy}>
            {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Passwort speichern'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
