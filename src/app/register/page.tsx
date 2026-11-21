"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Building2, Loader2, Lock, Mail, MapPin, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

interface SignupInfo {
  enabled: boolean;
  termsUrl: string | null;
  privacyUrl: string | null;
}

export default function RegisterPage() {
  const { toast } = useToast();
  const [info, setInfo] = useState<SignupInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    companyName: '', name: '', email: '', password: '', passwordRepeat: '', acceptTerms: false,
  });

  useEffect(() => {
    fetch('/api/auth/register')
      .then(r => r.json())
      .then(setInfo)
      .catch(() => setInfo({ enabled: false, termsUrl: null, privacyUrl: null }));
  }, []);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.passwordRepeat) {
      toast({ variant: 'destructive', title: 'Passwörter stimmen nicht überein' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName,
          name: form.name,
          email: form.email,
          password: form.password,
          acceptTerms: form.acceptTerms,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Registrierung fehlgeschlagen');
      // Full reload so the session cookie is picked up; settings shows the setup checklist.
      window.location.href = '/settings';
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Registrierung fehlgeschlagen',
        description: error instanceof Error ? error.message : undefined,
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="max-w-lg w-full text-center mb-8">
        <div className="inline-flex p-3 bg-primary/10 rounded-2xl mb-4">
          <MapPin className="text-primary w-10 h-10" />
        </div>
        <h1 className="text-4xl font-black text-primary mb-2 uppercase tracking-tighter">Unternehmen registrieren</h1>
        <p className="text-muted-foreground font-medium">
          Einsatzplanung, Zeiterfassung und Leistungsnachweise für Ihren Hausmeisterservice.
        </p>
      </div>

      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-8 border border-primary/10">
        {!info ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !info.enabled ? (
          <div className="text-center space-y-4 py-6">
            <p className="font-bold">Die Registrierung ist auf diesem Server derzeit nicht freigeschaltet.</p>
            <p className="text-sm text-muted-foreground">Bitte wenden Sie sich an den Betreiber oder melden Sie sich mit einem bestehenden Konto an.</p>
            <Link href="/" className="inline-block text-sm font-bold text-primary hover:underline">Zur Anmeldung</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="companyName">Firmenname</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="companyName" className="pl-10 h-12" placeholder="Muster Hausmeisterservice GmbH"
                  value={form.companyName} onChange={set('companyName')} required minLength={2} maxLength={120} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Ihr Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="name" className="pl-10 h-12" placeholder="Max Mustermann" autoComplete="name"
                  value={form.name} onChange={set('name')} required minLength={2} maxLength={120} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail-Adresse (Ihr Login)</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="email" type="email" className="pl-10 h-12" placeholder="max@meinefirma.de" autoComplete="email"
                  value={form.email} onChange={set('email')} required />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input id="password" type="password" className="pl-10 h-12" autoComplete="new-password"
                    value={form.password} onChange={set('password')} required minLength={12} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="passwordRepeat">Wiederholen</Label>
                <Input id="passwordRepeat" type="password" className="h-12" autoComplete="new-password"
                  value={form.passwordRepeat} onChange={set('passwordRepeat')} required minLength={12} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">Mindestens 12 Zeichen.</p>

            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <Checkbox
                checked={form.acceptTerms}
                onCheckedChange={v => setForm(f => ({ ...f, acceptTerms: v === true }))}
                className="mt-0.5"
              />
              <span className="text-muted-foreground">
                Ich akzeptiere die{' '}
                {info.termsUrl
                  ? <a href={info.termsUrl} target="_blank" rel="noreferrer" className="font-bold text-primary hover:underline">AGB</a>
                  : 'AGB'}{' '}
                und habe die{' '}
                {info.privacyUrl
                  ? <a href={info.privacyUrl} target="_blank" rel="noreferrer" className="font-bold text-primary hover:underline">Datenschutzerklärung</a>
                  : 'Datenschutzerklärung'}{' '}
                gelesen.
              </span>
            </label>

            <Button type="submit" className="w-full h-12 font-black text-lg shadow-lg" disabled={submitting || !form.acceptTerms}>
              {submitting ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Konto erstellen'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Schon registriert? <Link href="/" className="font-bold text-primary hover:underline">Anmelden</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
