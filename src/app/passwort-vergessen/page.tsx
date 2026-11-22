'use client';
/** Passwort vergessen: Link per E-Mail anfordern (Antwort verrät nicht, ob es die Adresse gibt). */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader2, Mail, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/components/auth/AuthCard';

export default function ForgotPasswordPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/password/forgot').then(r => r.json()).then(j => setEnabled(!!j.enabled)).catch(() => setEnabled(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/password/forgot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error);
      setSent(email.trim());
    } catch (err: any) {
      setError(err?.message || 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Passwort vergessen" subtitle="Wir schicken Ihnen einen Link zum Festlegen eines neuen Passworts.">
      {enabled === null ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : !enabled ? (
        <div className="text-center space-y-4 py-4">
          <p className="font-bold">Auf diesem Server ist kein E-Mail-Versand eingerichtet.</p>
          <p className="text-sm text-muted-foreground">Bitte wenden Sie sich an Ihr Büro bzw. Ihren Administrator, um ein neues Passwort zu erhalten.</p>
          <Link href="/" className="inline-block text-sm font-bold text-primary hover:underline">Zur Anmeldung</Link>
        </div>
      ) : sent ? (
        <div className="text-center space-y-4 py-2">
          <MailCheck className="w-12 h-12 text-emerald-600 mx-auto" />
          <p className="font-bold">Bitte Posteingang prüfen</p>
          <p className="text-sm text-muted-foreground">
            Wenn es ein Konto mit <b>{sent}</b> gibt, ist eine E-Mail unterwegs. Der Link ist 60 Minuten gültig.
            Nichts angekommen? Auch den Spam-Ordner prüfen.
          </p>
          <Link href="/" className="inline-block text-sm font-bold text-primary hover:underline">Zur Anmeldung</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">E-Mail-Adresse</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="email" type="email" className="pl-10 h-12" autoComplete="email" autoFocus
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          </div>
          {error && <p className="text-sm text-destructive font-medium">{error}</p>}
          <Button type="submit" className="w-full h-12 font-black text-lg" disabled={busy}>
            {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Link senden'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/" className="font-bold text-primary hover:underline">Zurück zur Anmeldung</Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
