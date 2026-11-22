'use client';
/** E-Mail-Adresse bestätigen (Link aus der Bestätigungs-Mail). */
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { AuthCard } from '@/components/auth/AuthCard';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async r => {
        const json = await r.json();
        setState(r.ok ? { ok: true, text: `${json.data.email} ist bestätigt.` } : { ok: false, text: json?.error || 'Der Link ist ungültig.' });
      })
      .catch(() => setState({ ok: false, text: 'Keine Verbindung zum Server.' }));
  }, [token]);

  return (
    <AuthCard title="E-Mail bestätigen">
      <div className="text-center space-y-4 py-4">
        {!state ? <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" /> : (
          <>
            {state.ok ? <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" /> : <XCircle className="w-12 h-12 text-destructive mx-auto" />}
            <p className="font-bold">{state.text}</p>
            {!state.ok && <p className="text-sm text-muted-foreground">Nach der Anmeldung können Sie oben im Hinweis einen neuen Link anfordern.</p>}
            <Link href="/dashboard" className="inline-block text-sm font-bold text-primary hover:underline">Weiter zur App</Link>
          </>
        )}
      </div>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return <Suspense fallback={null}><Verify /></Suspense>;
}
