"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/layout/Shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Building2, Phone, Mail, Globe, FileText, Image as ImageIcon,
  Save, Loader2, CheckCircle, Upload, X, MapPin, Hash,
  Palette, Info, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';
import { UserRole } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompanyForm {
  name: string;
  siteName: string;
  address: string;
  city: string;
  postalCode: string;
  taxNumber: string;
  phone: string;
  email: string;
  website: string;
  logoData: string;
}

const EMPTY: CompanyForm = {
  name: '', siteName: '', address: '', city: '',
  postalCode: '', taxNumber: '', phone: '', email: '',
  website: '', logoData: '',
};

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 py-8 first:pt-0">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="p-2 bg-primary/10 rounded-xl">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-black text-sm uppercase tracking-widest text-primary">{title}</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mt-2 pl-10">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { userProfile, isUserLoading } = useAuth();
  const { toast } = useToast();

  const role      = (userProfile?.role ?? 'WORKER') as UserRole;
  const userName  = userProfile?.name ?? '';
  const companyId = userProfile?.companyId ?? '';

  const [form, setForm]       = useState<CompanyForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Load company data ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'query', table: 'companies', filters: { id: companyId } }),
    })
      .then(r => r.json())
      .then(data => {
        const row = data?.data?.[0];
        if (row) {
          setForm({
            name:        row.name        ?? '',
            siteName:    row.site_name   ?? '',
            address:     row.address     ?? '',
            city:        row.city        ?? '',
            postalCode:  row.postal_code ?? '',
            taxNumber:   row.tax_number  ?? '',
            phone:       row.phone       ?? '',
            email:       row.email       ?? '',
            website:     row.website     ?? '',
            logoData:    row.logo_data   ?? '',
          });
        }
      })
      .catch(() => toast({ title: 'Fehler beim Laden', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [companyId]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!companyId) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          table: 'companies',
          filters: { id: companyId },
          data: {
            name:        form.name,
            site_name:   form.siteName   || null,
            address:     form.address    || null,
            city:        form.city       || null,
            postal_code: form.postalCode || null,
            tax_number:  form.taxNumber  || null,
            phone:       form.phone      || null,
            email:       form.email      || null,
            website:     form.website    || null,
            logo_data:   form.logoData   || null,
          },
        }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      toast({ title: 'Einstellungen gespeichert', description: 'Alle Änderungen wurden übernommen.' });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast({ title: 'Speichern fehlgeschlagen', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Logo upload ──────────────────────────────────────────────────────────────
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      toast({ title: 'Logo zu groß', description: 'Maximale Dateigröße: 500 KB', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => setForm(f => ({ ...f, logoData: ev.target?.result as string }));
    reader.readAsDataURL(file);
  };

  const set = (key: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Shell userRole={role} userName={userName}>
      <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase">Einstellungen</h1>
            <p className="text-muted-foreground font-medium">Firmenidentität, Kontakt & Dokumentenvorlagen</p>
          </div>
          <Button
            className="font-black h-12 px-8 rounded-2xl gap-2 shadow-md"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving  ? <Loader2 className="w-4 h-4 animate-spin" /> :
             saved   ? <CheckCircle className="w-4 h-4" />          :
                       <Save className="w-4 h-4" />}
            {saving ? 'Speichern…' : saved ? 'Gespeichert' : 'Speichern'}
          </Button>
        </div>

        {/* Access guard */}
        {!isUserLoading && role !== 'ADMIN' && (
          <Card className="rounded-3xl border-none shadow-md bg-amber-50">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="text-sm font-bold text-amber-800">
                Nur Administratoren können die Unternehmenseinstellungen bearbeiten.
              </p>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="font-bold">Einstellungen werden geladen…</span>
          </div>
        ) : (
          <Card className="rounded-3xl border-none shadow-lg overflow-hidden">
            <CardContent className="p-8 divide-y divide-gray-100">

              {/* ── 1. Branding ── */}
              <Section
                icon={Palette}
                title="Branding"
                description="Legen Sie den angezeigten Namen der Plattform und das Firmenlogo fest. Das Logo erscheint auf allen exportierten PDF-Dokumenten."
              >
                <Field label="Plattform-Name" hint="Wird in der Navigationsleiste angezeigt (leer = Firmenname)">
                  <Input
                    placeholder="z. B. Hausmeister Pro"
                    value={form.siteName}
                    onChange={set('siteName')}
                    className="h-12 rounded-xl font-medium"
                    disabled={role !== 'ADMIN'}
                  />
                </Field>

                {/* Logo upload */}
                <Field label="Firmenlogo" hint="PNG oder JPEG, max. 500 KB. Wird im PDF-Header angezeigt.">
                  <div className="flex items-center gap-4">
                    {form.logoData ? (
                      <div className="relative w-24 h-16 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={form.logoData} alt="Logo" className="max-w-full max-h-full object-contain p-1" />
                        {role === 'ADMIN' && (
                          <button
                            onClick={() => setForm(f => ({ ...f, logoData: '' }))}
                            className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-black/70"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="w-24 h-16 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center gap-1 shrink-0">
                        <ImageIcon className="w-5 h-5 text-gray-300" />
                        <span className="text-[9px] text-gray-400 font-bold uppercase">Kein Logo</span>
                      </div>
                    )}
                    {role === 'ADMIN' && (
                      <>
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={handleLogoChange}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="font-black text-xs rounded-xl gap-2 h-10 border-primary/20 hover:bg-primary/5"
                          onClick={() => logoInputRef.current?.click()}
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Logo hochladen
                        </Button>
                      </>
                    )}
                  </div>
                </Field>
              </Section>

              <Separator />

              {/* ── 2. Company identity ── */}
              <Section
                icon={Building2}
                title="Firmenidentität"
                description="Name und Anschrift Ihres Unternehmens. Diese Angaben erscheinen auf Lohnzetteln und Arbeitszeitnachweisen."
              >
                <Field label="Firmenname *">
                  <Input
                    placeholder="z. B. Tuhmaz Gebäudeservice GmbH"
                    value={form.name}
                    onChange={set('name')}
                    className="h-12 rounded-xl font-medium"
                    disabled={role !== 'ADMIN'}
                  />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                  <Field label="Straße & Hausnummer">
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Musterstraße 12"
                        value={form.address}
                        onChange={set('address')}
                        className="h-12 rounded-xl font-medium pl-9"
                        disabled={role !== 'ADMIN'}
                      />
                    </div>
                  </Field>
                  <Field label="PLZ">
                    <Input
                      placeholder="39104"
                      value={form.postalCode}
                      onChange={set('postalCode')}
                      className="h-12 rounded-xl font-medium"
                      disabled={role !== 'ADMIN'}
                    />
                  </Field>
                </div>

                <Field label="Stadt">
                  <Input
                    placeholder="Magdeburg"
                    value={form.city}
                    onChange={set('city')}
                    className="h-12 rounded-xl font-medium"
                    disabled={role !== 'ADMIN'}
                  />
                </Field>
              </Section>

              <Separator />

              {/* ── 3. Tax & Legal ── */}
              <Section
                icon={Hash}
                title="Steuer & Rechtliches"
                description="Steuerliche Identifikation Ihres Unternehmens. Wird auf offiziellen Dokumenten und Abrechnungen ausgewiesen."
              >
                <Field label="Steuernummer" hint="Format: 123/456/78901 (je nach Bundesland)">
                  <div className="relative">
                    <FileText className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="123/456/78901"
                      value={form.taxNumber}
                      onChange={set('taxNumber')}
                      className="h-12 rounded-xl font-medium pl-9"
                      disabled={role !== 'ADMIN'}
                    />
                  </div>
                </Field>
              </Section>

              <Separator />

              {/* ── 4. Contact ── */}
              <Section
                icon={Phone}
                title="Kontakt"
                description="Telefon, E-Mail und Website erscheinen im Footer aller PDF-Exporte sowie in Kundendokumenten."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Telefon">
                    <div className="relative">
                      <Phone className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="+49 391 123456"
                        value={form.phone}
                        onChange={set('phone')}
                        className="h-12 rounded-xl font-medium pl-9"
                        disabled={role !== 'ADMIN'}
                      />
                    </div>
                  </Field>
                  <Field label="E-Mail">
                    <div className="relative">
                      <Mail className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="info@meinefirma.de"
                        type="email"
                        value={form.email}
                        onChange={set('email')}
                        className="h-12 rounded-xl font-medium pl-9"
                        disabled={role !== 'ADMIN'}
                      />
                    </div>
                  </Field>
                </div>

                <Field label="Website (optional)">
                  <div className="relative">
                    <Globe className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="www.meinefirma.de"
                      value={form.website}
                      onChange={set('website')}
                      className="h-12 rounded-xl font-medium pl-9"
                      disabled={role !== 'ADMIN'}
                    />
                  </div>
                </Field>
              </Section>

              <Separator />

              {/* ── 5. Document preview ── */}
              <Section
                icon={Info}
                title="Vorschau PDF-Header"
                description="So sieht der Kopfbereich Ihrer Lohnzettel und Arbeitszeitnachweise aus."
              >
                <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
                  {/* PDF header simulation */}
                  <div
                    className="flex items-start justify-between px-5 py-4"
                    style={{ background: '#0f2850' }}
                  >
                    <div className="flex items-center gap-3">
                      {form.logoData && (
                        <div className="w-12 h-8 bg-white/10 rounded-lg overflow-hidden flex items-center justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={form.logoData} alt="" className="max-w-full max-h-full object-contain p-0.5" />
                        </div>
                      )}
                      <div>
                        <p className="text-white font-black text-sm uppercase tracking-wide">
                          {form.name || 'Firmenname'}
                        </p>
                        {(form.address || form.postalCode || form.city) && (
                          <p className="text-white/60 text-[10px] mt-0.5">
                            {[form.address, [form.postalCode, form.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {(form.phone || form.email) && (
                          <p className="text-white/50 text-[9px]">
                            {[form.phone, form.email].filter(Boolean).join('  ·  ')}
                          </p>
                        )}
                        {form.taxNumber && (
                          <p className="text-white/40 text-[9px]">St.-Nr.: {form.taxNumber}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-black text-base uppercase">LOHNZETTEL</p>
                      <p className="text-white/60 text-[10px]">APRIL 2026</p>
                    </div>
                  </div>
                  {/* Footer simulation */}
                  <div
                    className="flex items-center justify-between px-5 py-2"
                    style={{ background: '#0f2850' }}
                  >
                    <p className="text-white/60 text-[9px]">
                      {[form.name, form.website].filter(Boolean).join('  ·  ') || 'Firmenname · www.website.de'}
                    </p>
                    <p className="text-white/60 text-[9px]">Seite 1</p>
                  </div>
                  {/* Body placeholder */}
                  <div className="bg-gray-50 px-5 py-6 flex items-center justify-center">
                    <p className="text-xs text-muted-foreground font-bold">— Dokumentinhalt —</p>
                  </div>
                </div>
              </Section>

            </CardContent>
          </Card>
        )}

        {/* Bottom save */}
        {!loading && (
          <div className="flex justify-end pb-8">
            <Button
              className="font-black h-12 px-10 rounded-2xl gap-2 shadow-md"
              onClick={handleSave}
              disabled={saving || role !== 'ADMIN'}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> :
               saved  ? <CheckCircle className="w-4 h-4" />          :
                        <Save className="w-4 h-4" />}
              {saving ? 'Speichern…' : saved ? 'Gespeichert!' : 'Einstellungen speichern'}
            </Button>
          </div>
        )}
      </div>
    </Shell>
  );
}
