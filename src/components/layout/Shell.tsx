"use client";

import React, { useState } from 'react';
import {
  LayoutDashboard, Calendar, MapPin, Users, FileText, LogOut,
  Clock, Briefcase, UserCheck, Settings, Lock, Loader2
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider,
  SidebarTrigger, SidebarInset
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserRole } from '@/lib/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';

interface ShellProps {
  children: React.ReactNode;
  userRole: UserRole;
  userName: string;
}

export function Shell({ children, userRole, userName }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, changePassword } = useAuth();
  const { toast } = useToast();

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const navItems = [
    { label: 'Übersicht',     icon: LayoutDashboard, href: '/dashboard',  roles: ['ADMIN', 'LEADER', 'WORKER'] },
    { label: 'Tourplan',      icon: Calendar,        href: '/schedule',   roles: ['ADMIN', 'LEADER', 'WORKER'] },
    { label: 'Einsatzplanung',icon: UserCheck,       href: '/deployment', roles: ['LEADER', 'ADMIN'] },
    { label: 'Objekte',       icon: Briefcase,       href: '/jobs',       roles: ['ADMIN', 'LEADER'] },
    { label: 'Zeiterfassung', icon: Clock,           href: '/tracking',   roles: ['WORKER', 'LEADER', 'ADMIN'] },
    { label: 'Team',          icon: Users,           href: '/team',       roles: ['ADMIN', 'LEADER'] },
    { label: 'Berichte',      icon: FileText,        href: '/reports',    roles: ['ADMIN', 'LEADER'] },
    { label: 'Einstellungen', icon: Settings,        href: '/settings',   roles: ['ADMIN'] },
  ];

  const filteredNavItems = navItems.filter(item => item.roles.includes(userRole));

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'Fehler', description: 'Passwörter stimmen nicht überein.' });
      return;
    }
    if (newPassword.length < 6) {
      toast({ variant: 'destructive', title: 'Fehler', description: 'Mindestens 6 Zeichen erforderlich.' });
      return;
    }
    setIsUpdating(true);
    try {
      await changePassword(newPassword);
      toast({ title: 'Erfolg', description: 'Passwort aktualisiert.' });
      setIsPasswordModalOpen(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast({ variant: 'destructive', title: 'Fehler', description: error instanceof Error ? error.message : 'Unbekannter Fehler' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <SidebarProvider>
      <Sidebar className="border-none shadow-xl print:hidden">
        <SidebarHeader className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent rounded-lg flex items-center justify-center">
              <MapPin className="text-primary w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight text-white">Haus Pro</h1>
              <p className="text-xs text-sidebar-foreground/70 uppercase font-semibold">Tuhmaz Group</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-3">
          <SidebarMenu>
            {filteredNavItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  onClick={() => router.push(item.href)}
                  isActive={pathname === item.href}
                  className="rounded-lg transition-all duration-200"
                  tooltip={item.label}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="p-4 mt-auto">
          <div className="bg-sidebar-accent/50 p-4 rounded-xl flex items-center gap-3 mb-2">
            <Avatar>
              <AvatarImage src={`https://picsum.photos/seed/${userName}/100/100`} />
              <AvatarFallback>{userName.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold truncate text-white">{userName}</p>
              <p className="text-[10px] text-sidebar-foreground/70 uppercase font-black">{userRole}</p>
            </div>
          </div>
          <div className="space-y-1">
            <Button
              variant="ghost"
              className="w-full justify-start text-sidebar-foreground/80 hover:text-white hover:bg-white/10 rounded-lg h-9"
              onClick={() => setIsPasswordModalOpen(true)}
            >
              <Settings className="mr-2 h-4 w-4" /> Sicherheit
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start text-sidebar-foreground/80 hover:text-white hover:bg-destructive/10 hover:text-destructive transition-colors rounded-lg h-9"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" /> Abmelden
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-background flex flex-col">
        <header className="h-16 border-b flex items-center justify-between px-6 bg-white sticky top-0 z-10 print:hidden">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <div className="h-6 w-[1px] bg-border hidden md:block" />
            <h2 className="text-lg font-bold text-primary capitalize hidden md:block">
              {pathname === '/dashboard'  ? 'Übersicht'      :
               pathname === '/schedule'   ? 'Tourplan'        :
               pathname === '/deployment' ? 'Einsatz'         :
               pathname === '/jobs'       ? 'Objekte'         :
               pathname === '/tracking'   ? 'Zeiterfassung'   :
               pathname === '/team'       ? 'Team'            :
               pathname === '/reports'    ? 'Berichte'        :
               pathname === '/settings'   ? 'Einstellungen'   : 'Home'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="bg-primary/5 text-primary border-none font-black text-[10px] px-3">
              SYSTEM LIVE: 2026
            </Badge>
          </div>
        </header>
        <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full print:p-0 print:max-w-none">
          {children}
        </main>
      </SidebarInset>

      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-[400px] rounded-3xl">
          <DialogHeader>
            <DialogTitle>Passwort ändern</DialogTitle>
            <DialogDescription>Legen Sie ein neues Passwort für Ihren Zugang fest.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Neues Passwort</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input type="password" className="pl-10 h-12" placeholder="Mind. 6 Zeichen"
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Bestätigen</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input type="password" className="pl-10 h-12" placeholder="Wiederholen"
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full font-black h-12 rounded-2xl" onClick={handleChangePassword} disabled={isUpdating}>
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sicher speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
