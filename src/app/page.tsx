"use client";

import { Button } from '@/components/ui/button';
import { MapPin, Loader2, Mail, Lock } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function EntryPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(email, password);
      // AuthGuard redirects automatically after session is set
    } catch (error) {
      toast({
        variant:     'destructive',
        title:       'Anmeldefehler',
        description: error instanceof Error ? error.message : 'Überprüfen Sie Ihre Zugangsdaten.',
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="max-w-4xl w-full text-center mb-12 animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="inline-flex p-3 bg-primary/10 rounded-2xl mb-4">
          <MapPin className="text-primary w-10 h-10" />
        </div>
        <h1 className="text-5xl font-black text-primary mb-4 uppercase tracking-tighter">Tuhmaz Hausmeister Pro</h1>
        <p className="text-muted-foreground text-xl font-medium">Betriebsführungssystem | Version 2026</p>
      </div>

      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-8 border border-primary/10">
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">E-Mail-Adresse</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="benutzer@firma.de"
                className="pl-10 h-12"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Passwort</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                className="pl-10 h-12"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
          </div>
          <Button type="submit" className="w-full h-12 font-black text-lg shadow-lg" disabled={isLoading}>
            {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Anmelden'}
          </Button>
        </form>
      </div>

      <p className="mt-12 text-sm text-muted-foreground font-bold uppercase tracking-widest">
        Internes System — Nur für autorisierte Mitarbeiter
      </p>
    </div>
  );
}
