"use client";

import React, { useState, useEffect } from 'react';
import { Shell } from '@/components/layout/Shell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  UserPlus,
  Search,
  Check,
  Euro,
  Trash2,
  Edit,
  Shield,
  Users,
  Loader2,
  Lock
} from 'lucide-react';
import { User as UserType, ContractType, UserRole } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/db/provider';
import { useQuery } from '@/db/use-query';

const BUNDESLAENDER = [
  { code: 'BW', name: 'Baden-Württemberg', churchTax: 8 },
  { code: 'BY', name: 'Bayern', churchTax: 8 },
  { code: 'BE', name: 'Berlin', churchTax: 9 },
  { code: 'BB', name: 'Brandenburg', churchTax: 9 },
  { code: 'HB', name: 'Bremen', churchTax: 9 },
  { code: 'HH', name: 'Hamburg', churchTax: 9 },
  { code: 'HE', name: 'Hessen', churchTax: 9 },
  { code: 'MV', name: 'Mecklenburg-Vorpommern', churchTax: 9 },
  { code: 'NI', name: 'Niedersachsen', churchTax: 9 },
  { code: 'NW', name: 'Nordrhein-Westfalen', churchTax: 9 },
  { code: 'RP', name: 'Rheinland-Pfalz', churchTax: 9 },
  { code: 'SL', name: 'Saarland', churchTax: 9 },
  { code: 'SN', name: 'Sachsen', churchTax: 9 },
  { code: 'ST', name: 'Sachsen-Anhalt', churchTax: 9 },
  { code: 'SH', name: 'Schleswig-Holstein', churchTax: 9 },
  { code: 'TH', name: 'Thüringen', churchTax: 9 },
];
const MIN_PASSWORD_LENGTH = 6;
const MANAGED_ROLE_OPTIONS: Record<UserRole, UserRole[]> = {
  ADMIN: ['WORKER', 'LEADER', 'ADMIN'],
  LEADER: ['WORKER'],
  WORKER: ['WORKER'],
};

type TeamMemberFormData = Partial<UserType> & {
  password: string;
  confirmPassword: string;
  svNr?: string;
  steuerId?: string;
  statusTaetigkeit?: string;
};

export default function TeamPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const { userProfile, isUserLoading } = useAuth();
  const user = userProfile;

  const companyId = userProfile?.companyId ?? '';
  const hasContext = !!userProfile && !!companyId;

  const effectiveRole = (userProfile?.role ?? 'WORKER') as UserRole;
  const effectiveUserName = userProfile?.name ?? 'Admin';
  const effectiveCompanyId = companyId;
  const allowedManagedRoles = MANAGED_ROLE_OPTIONS[effectiveRole ?? 'WORKER'] ?? ['WORKER'];

  const { data: teamRaw, isLoading, refresh: refreshTeam } = useQuery({
    table: 'users',
    filters: hasContext ? { company_id: effectiveCompanyId } : undefined,
    enabled: hasContext,
    realtime: true,
  });

  // Map DB rows (snake_case) to app UserType (camelCase)
  const team: UserType[] = React.useMemo(() => {
    if (!teamRaw) return [];
    return (teamRaw as any[]).map((row: any) => ({
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      email: row.email,
      role: row.role,
      hourlyRate: row.hourly_rate,
      contractType: row.contract_type,
      taxClass: row.tax_class,
      kinder: row.kinder,
      hasChurchTax: row.has_church_tax,
      bundesland: row.bundesland,
      canLoginWithPassword: row.can_login_with_password,
      authProvider: row.auth_provider,
      avatarUrl: row.avatar_url,
      svNr: row.sv_nr,
      steuerId: row.steuer_id,
      statusTaetigkeit: row.status_taetigkeit,
      kvZusatzRate: parseFloat(row.kv_zusatz_rate) || 1.7,
    }));
  }, [teamRaw]);

  const [formData, setFormData] = useState<TeamMemberFormData>({
    name: '',
    email: '',
    role: 'WORKER',
    hourlyRate: 15.00,
    contractType: 'VOLLZEIT',
    taxClass: 1,
    kinder: 0,
    hasChurchTax: false,
    bundesland: 'ST',
    kvZusatzRate: 1.7,
    password: '',
    confirmPassword: '',
  });

  const handleSaveMember = async () => {
    const trimmedName = formData.name?.trim();
    const normalizedEmail = formData.email?.trim().toLowerCase();
    const requestedRole = (formData.role && allowedManagedRoles.includes(formData.role) ? formData.role : allowedManagedRoles[0]) || 'WORKER';

    if (!trimmedName || !normalizedEmail) {
      toast({
        variant: "destructive",
        title: "Fehlende Angaben",
        description: "Name und E-Mail-Adresse sind erforderlich.",
      });
      return;
    }

    if (!allowedManagedRoles.includes(requestedRole)) {
      toast({
        variant: "destructive",
        title: "Rolle nicht erlaubt",
        description: "Diese Rolle kann mit Ihrem Zugriff nicht vergeben werden.",
      });
      return;
    }

    if (!editingUser) {
      if (!formData.password || formData.password.length < MIN_PASSWORD_LENGTH) {
        toast({
          variant: "destructive",
          title: "Passwort zu kurz",
          description: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`,
        });
        return;
      }

      if (formData.password !== formData.confirmPassword) {
        toast({
          variant: "destructive",
          title: "Passwörter stimmen nicht überein",
          description: "Bitte bestätigen Sie das Passwort erneut.",
        });
        return;
      }
    }

    if (editingUser && effectiveRole === 'ADMIN' && formData.password) {
      if (formData.password.length > 0 && formData.password.length < MIN_PASSWORD_LENGTH) {
        toast({
          variant: "destructive",
          title: "Passwort zu kurz",
          description: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`,
        });
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        toast({
          variant: "destructive",
          title: "Passwörter stimmen nicht überein",
          description: "Bitte bestätigen Sie das Passwort erneut.",
        });
        return;
      }
    }

    try {
      setIsSaving(true);

      if (!editingUser) {
        // Create invite record
        const inviteId = `invite-${crypto.randomUUID()}`;
        await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'insert',
            table: 'account_invites',
            data: {
              id: inviteId,
              company_id: effectiveCompanyId,
              email: normalizedEmail,
              name: trimmedName,
              role: requestedRole,
              created_by: user?.id ?? null,
            },
          }),
        });

        // Provision user via API route (uses service role key server-side)
        const response = await fetch('/api/provision-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: normalizedEmail,
            password: formData.password,
            name: trimmedName,
            role: requestedRole,
            companyId: effectiveCompanyId,
          }),
        });
        if (!response.ok) {
          // Attempt to clean up invite on failure
          await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', table: 'account_invites', filters: { id: inviteId } }),
          });
          throw new Error((await response.json()).error ?? 'Fehler beim Erstellen des Benutzerkontos');
        }

        toast({
          title: "Hinzugefügt",
          description: "Mitarbeiterkonto inklusive E-Mail-Login wurde erfolgreich erstellt.",
        });
        refreshTeam();
      } else {
        // Update existing user in users table
        const updateRes = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            table: 'users',
            filters: { id: editingUser.id },
            data: {
              name: trimmedName,
              role: requestedRole,
              hourly_rate: formData.hourlyRate || 15,
              contract_type: formData.contractType || 'VOLLZEIT',
              tax_class: formData.taxClass || 1,
              kinder: formData.kinder || 0,
              has_church_tax: !!formData.hasChurchTax,
              bundesland: formData.bundesland || 'ST',
              sv_nr: formData.svNr || null,
              steuer_id: formData.steuerId || null,
              status_taetigkeit: formData.statusTaetigkeit || null,
              kv_zusatz_rate: formData.kvZusatzRate ?? 1.7,
            },
          }),
        });

        if (!updateRes.ok) { const j = await updateRes.json(); throw new Error(j?.error ?? 'Update fehlgeschlagen'); }

        toast({
          title: "Aktualisiert",
          description: "Mitarbeiterdaten wurden erfolgreich gespeichert.",
        });
        refreshTeam();
      }

      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Fehler beim Speichern",
        description: error instanceof Error ? error.message : "Mitarbeiter konnte nicht gespeichert werden.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      role: 'WORKER',
      hourlyRate: 15.00,
      contractType: 'VOLLZEIT',
      taxClass: 1,
      kinder: 0,
      hasChurchTax: false,
      bundesland: 'ST',
      kvZusatzRate: 1.7,
      password: '',
      confirmPassword: '',
    });
    setEditingUser(null);
  };

  const handleEdit = (member: UserType) => {
    if (effectiveRole !== 'ADMIN' && member.role !== 'WORKER') {
      toast({
        variant: 'destructive',
        title: 'Kein Zugriff',
        description: 'Nur Administratoren können Leiter- oder Admin-Konten bearbeiten.',
      });
      return;
    }

    setEditingUser(member);
    setFormData({
      ...member,
      taxClass: member.taxClass || (member as any).steuerklasse || 1,
      kinder: member.kinder || 0,
      hasChurchTax: member.hasChurchTax ?? (member as any).kirchensteuerpflichtig ?? false,
      bundesland: member.bundesland || 'ST',
      password: '',
      confirmPassword: '',
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (effectiveRole !== 'ADMIN') {
      toast({ variant: 'destructive', title: 'Kein Zugriff', description: 'Nur Administratoren können Konten entfernen.' });
      return;
    }

    try {
      // Deleting from public.users will cascade to related data.
      // NOTE: The corresponding auth.users record must be deleted separately
      // via the Supabase dashboard or an admin API call, as client-side
      // Supabase does not expose supabase.auth.admin on the browser client.
      const deleteRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', table: 'users', filters: { id } }),
      });
      if (!deleteRes.ok) throw new Error('delete failed');
      toast({ title: "Gelöscht", description: "Mitarbeiter wurde entfernt." });
      refreshTeam();
    } catch {
      toast({ variant: "destructive", title: "Fehler beim Löschen" });
    }
  };

  const filteredTeam = team?.filter(member => member.name.toLowerCase().includes(searchQuery.toLowerCase())) || [];

  return (
    <Shell userRole={effectiveRole} userName={effectiveUserName}>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase">Teamverwaltung</h1>
            <p className="text-muted-foreground font-medium">Löhne, Rollen & Steuerdaten für Sachsen-Anhalt</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="font-bold h-12 px-6 shadow-lg"><UserPlus className="mr-2 h-5 w-5" />Neuer Mitarbeiter</Button>
            </DialogTrigger>
            <DialogContent aria-describedby="team-form-description" className="sm:max-w-3xl rounded-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black">{editingUser ? 'Mitarbeiter bearbeiten' : 'Neuen Mitarbeiter hinzufügen'}</DialogTitle>
                <DialogDescription id="team-form-description" className="font-medium">Vollständige Erfassung der steuerrelevanten Daten.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 py-6">
                <div className="md:col-span-2 space-y-2">
                  <Label>Vollständiger Name</Label>
                  <Input placeholder="Vor- und Nachname" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="h-12"/>
                </div>
                <div className="space-y-2">
                  <Label>E-Mail</Label>
                  <Input placeholder="mitarbeiter@firma.de" type="email" value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} className="h-12" disabled={!!editingUser}/>
                </div>
                <div className="space-y-2">
                  <Label>Rolle im System</Label>
                  <Select
                    value={formData.role || allowedManagedRoles[0] || 'WORKER'}
                    onValueChange={(val: UserRole) => setFormData({...formData, role: val})}
                    disabled={!!editingUser && effectiveRole !== 'ADMIN'}
                  >
                    <SelectTrigger className="h-12"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {allowedManagedRoles.includes('LEADER') && <SelectItem value="LEADER">Teamleiter</SelectItem>}
                      <SelectItem value="WORKER">Mitarbeiter</SelectItem>
                      {allowedManagedRoles.includes('ADMIN') && <SelectItem value="ADMIN">Administrator</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{editingUser ? (effectiveRole === 'ADMIN' ? 'Neues Passwort' : 'Login-Status') : 'Temporäres Passwort'}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-10 h-12"
                      type="password"
                      value={formData.password}
                      onChange={e => setFormData({...formData, password: e.target.value})}
                      placeholder={editingUser ? (effectiveRole === 'ADMIN' ? 'Neues Passwort leer lassen' : 'Bereits eingerichtet') : 'Mindestens 6 Zeichen'}
                      disabled={!!editingUser && effectiveRole !== 'ADMIN'}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{editingUser ? (effectiveRole === 'ADMIN' ? 'Passwort bestätigen' : 'Hinweis') : 'Passwort bestätigen'}</Label>
                  {editingUser && effectiveRole !== 'ADMIN' ? (
                    <div className="h-12 rounded-xl border bg-muted/30 px-4 flex items-center text-sm font-medium text-muted-foreground">
                      Passwort-Reset erfolgt derzeit über ein neues Konto oder direkt durch den Mitarbeiter.
                    </div>
                  ) : (
                    <Input
                      className="h-12"
                      type="password"
                      value={formData.confirmPassword}
                      onChange={e => setFormData({...formData, confirmPassword: e.target.value})}
                      placeholder={editingUser ? 'Neues Passwort bestätigen' : 'Passwort erneut eingeben'}
                    />
                  )}
                </div>

                <div className="md:col-span-2 border-t pt-4 mt-2">
                  <h3 className="font-black text-primary uppercase text-sm tracking-widest flex items-center gap-2"><Euro className="w-4 h-4"/> Vertrag & Lohn</h3>
                </div>
                <div className="space-y-2">
                  <Label>Anstellungsart</Label>
                  <Select value={formData.contractType || 'VOLLZEIT'} onValueChange={(val: ContractType) => setFormData({...formData, contractType: val})}>
                    <SelectTrigger className="h-12"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MINIJOB">Minijob (bis 603€)</SelectItem>
                      <SelectItem value="MIDIJOB">Midijob (603€ - 2.000€)</SelectItem>
                      <SelectItem value="VOLLZEIT">Vollzeit</SelectItem>
                      <SelectItem value="TEILZEIT">Teilzeit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Stundenlohn (Brutto)</Label>
                  <div className="relative">
                    <Euro className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9 h-12" type="number" step="0.50" value={formData.hourlyRate ?? 15} onChange={e => setFormData({...formData, hourlyRate: parseFloat(e.target.value) || 0})} />
                  </div>
                </div>

                <div className="md:col-span-2 border-t pt-4 mt-2">
                  <h3 className="font-black text-primary uppercase text-sm tracking-widest flex items-center gap-2"><Shield className="w-4 h-4"/> Steuerdaten</h3>
                </div>
                <div className="space-y-2">
                  <Label>Lohnsteuerklasse</Label>
                  <Select value={String(formData.taxClass || 1)} onValueChange={(val) => setFormData({...formData, taxClass: parseInt(val, 10) as 1 | 2 | 3 | 4 | 5 | 6})}>
                    <SelectTrigger className="h-12"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4,5,6].map(c => <SelectItem key={c} value={String(c)}>Steuerklasse {c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Kinderfreibeträge</Label>
                  <Input type="number" className="h-12" value={formData.kinder ?? 0} onChange={e => setFormData({...formData, kinder: parseInt(e.target.value || '0', 10) || 0})} />
                </div>
                <div className="space-y-2">
                  <Label>Bundesland</Label>
                  <Select value={formData.bundesland || 'ST'} onValueChange={(val) => setFormData({...formData, bundesland: val})}>
                    <SelectTrigger className="h-12"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {BUNDESLAENDER.map((bundesland) => (
                        <SelectItem key={bundesland.code} value={bundesland.code}>
                          {bundesland.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-2xl border md:col-span-2">
                  <div className="space-y-1">
                    <Label className="font-black">Kirchensteuerpflichtig</Label>
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">9% Kirchensteuer in Sachsen-Anhalt</p>
                  </div>
                  <Switch checked={!!formData.hasChurchTax} onCheckedChange={(val) => setFormData({...formData, hasChurchTax: val})} />
                </div>
                <div className="space-y-2">
                  <Label>KV-Zusatzbeitrag (%)</Label>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Zusatzbeitrag der Krankenkasse (z.B. 1.20 TK · 1.70 DAK · 1.90 Barmer)</p>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="5"
                    className="h-12"
                    value={formData.kvZusatzRate ?? 1.7}
                    onChange={e => setFormData({...formData, kvZusatzRate: parseFloat(e.target.value) || 0})}
                  />
                </div>

                <div className="md:col-span-2 border-t pt-4 mt-2">
                  <h3 className="font-black text-primary uppercase text-sm tracking-widest flex items-center gap-2"><UserPlus className="w-4 h-4"/> Erweiterte Mitarbeiterdaten</h3>
                </div>
                <div className="space-y-2">
                  <Label>SV-Nr. (Sozialversicherungsnummer)</Label>
                  <Input placeholder="z.B. 12 345678 9 0" value={formData.svNr || ''} onChange={e => setFormData({...formData, svNr: e.target.value})} className="h-12"/>
                </div>
                <div className="space-y-2">
                  <Label>Steuer-ID</Label>
                  <Input placeholder="11-stellige Nummer" value={formData.steuerId || ''} onChange={e => setFormData({...formData, steuerId: e.target.value})} className="h-12"/>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Label>Status / Tätigkeit</Label>
                  <Input placeholder="z.B. Gebäudereiniger, Hausmeister" value={formData.statusTaetigkeit || ''} onChange={e => setFormData({...formData, statusTaetigkeit: e.target.value})} className="h-12"/>
                </div>

              </div>
              <DialogFooter className="gap-3">
                <Button variant="outline" className="h-12 flex-1 rounded-xl font-bold" onClick={() => setIsDialogOpen(false)}>Abbrechen</Button>
                <Button className="h-12 flex-1 rounded-xl font-black text-lg" onClick={handleSaveMember} disabled={isSaving || isUserLoading}>
                  {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />}
                  Speichern
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="relative">
          <Search className="absolute left-4 top-4 h-5 w-5 text-muted-foreground" />
          <Input placeholder="Mitarbeiter suchen..." className="pl-12 h-14 bg-white rounded-2xl shadow-sm border-none font-medium" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}/>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1,2,3].map(i => <Card key={i} className="h-48 animate-pulse bg-white/50 border-none rounded-3xl"/>)}
          </div>
        ) : filteredTeam.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTeam.map((member) => (
              <Card key={member.id} className="border-none shadow-xl bg-white hover:scale-[1.02] transition-all rounded-3xl overflow-hidden group">
                <div className="h-1.5 w-full bg-primary/10 group-hover:bg-primary transition-colors" />
                <CardHeader className="flex flex-row items-center gap-4 pb-2">
                  <Avatar className="w-12 h-12 shadow-md">
                    <AvatarImage src={`https://picsum.photos/seed/${member.id}/100/100`} />
                    <AvatarFallback className="font-black text-primary">{member.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg font-black truncate">{member.name}</CardTitle>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-[9px] font-black uppercase px-2 py-0.5 bg-primary/5 text-primary border-none">
                        {member.role}
                      </Badge>
                      {member.canLoginWithPassword && (
                        <Badge variant="outline" className="text-[9px] font-black uppercase px-2 py-0.5 border-emerald-200 text-emerald-700 bg-emerald-50">
                          Login aktiv
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-primary/5 text-primary" onClick={() => handleEdit(member)}><Edit className="w-4 h-4"/></Button>
                    {effectiveRole === 'ADMIN' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-destructive/5 text-destructive" onClick={() => handleDelete(member.id)}><Trash2 className="w-4 h-4"/></Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 bg-gray-50 rounded-2xl border border-transparent hover:border-primary/10 transition-colors">
                      <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Stundensatz</p>
                      <p className="text-sm font-black text-primary">{member.hourlyRate ? Number(member.hourlyRate).toFixed(2) : '-'} €</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-2xl border border-transparent hover:border-primary/10 transition-colors">
                      <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Vertrag</p>
                      <p className="text-sm font-black text-foreground">{member.contractType}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-2">
                    <span className="text-[10px] font-black uppercase text-muted-foreground">Steuerklasse {member.taxClass || '-'}</span>
                    <span className="text-[10px] font-black uppercase text-muted-foreground">{member.hasChurchTax ? 'Kirche' : 'Keine Kirche'}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="py-24 text-center bg-white rounded-3xl border-2 border-dashed border-primary/20 flex flex-col items-center gap-4">
            <Users className="w-16 h-16 text-muted-foreground/30" />
            <h3 className="text-xl font-black text-foreground/80 uppercase">Keine Mitarbeiter</h3>
            <p className="text-sm text-muted-foreground font-medium">Legen Sie Ihr Team an, um mit der Planung zu beginnen.</p>
          </div>
        )}
      </div>
    </Shell>
  );
}
