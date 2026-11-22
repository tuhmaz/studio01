"use client";

/** Hinweis oben in der App, solange die eigene E-Mail-Adresse nicht bestätigt ist. */
import { useState } from 'react';
import { Loader2, MailWarning, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/db/provider';

export function VerifyEmailBanner() {
  const { userProfile } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (hidden || !userProfile?.mailEnabled || userProfile.emailVerified !== false) return null;

  const send = async () => {
    setState('sending');
    try {
      const res = await fetch('/api/auth/verify-email/resend', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error);
      setState('sent');
      setMessage(json.data?.alreadyVerified ? 'Ihre Adresse ist bereits bestätigt.' : `Link gesendet an ${userProfile.email}.`);
    } catch (e: any) {
      setState('error');
      setMessage(e?.message || 'Senden fehlgeschlagen.');
    }
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex flex-wrap items-center gap-3 text-sm text-amber-900">
      <MailWarning className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-[200px]">
        {state === 'sent' || state === 'error'
          ? message
          : <>Bitte bestätigen Sie Ihre E-Mail-Adresse <b>{userProfile.email}</b> – sonst funktioniert „Passwort vergessen“ nicht.</>}
      </span>
      {state !== 'sent' && (
        <Button size="sm" variant="outline" className="h-8 rounded-lg bg-white" onClick={send} disabled={state === 'sending'}>
          {state === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Bestätigungslink senden'}
        </Button>
      )}
      <button onClick={() => setHidden(true)} aria-label="Ausblenden" className="p-1 rounded hover:bg-amber-100"><X className="w-4 h-4" /></button>
    </div>
  );
}
