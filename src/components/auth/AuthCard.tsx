'use client';

/** Rahmen der öffentlichen Konto-Seiten (Passwort vergessen, Einladung, Bestätigung). */
import { MapPin } from 'lucide-react';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center mb-8">
        <div className="inline-flex p-3 bg-primary/10 rounded-2xl mb-4">
          <MapPin className="text-primary w-10 h-10" />
        </div>
        <h1 className="text-3xl font-black text-primary mb-2 uppercase tracking-tighter">{title}</h1>
        {subtitle && <p className="text-muted-foreground font-medium">{subtitle}</p>}
      </div>
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 border border-primary/10">{children}</div>
    </div>
  );
}
