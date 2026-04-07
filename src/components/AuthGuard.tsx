"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/db/provider';
import { Loader2 } from 'lucide-react';
import { UserRole } from '@/lib/types';

const PUBLIC_PATHS = ['/'];
const AUTH_TIMEOUT_MS = 8000;

const ROUTE_ROLE_ACCESS: Record<string, UserRole[]> = {
  '/dashboard':  ['ADMIN', 'LEADER', 'WORKER'],
  '/schedule':   ['ADMIN', 'LEADER', 'WORKER'],
  '/tracking':   ['ADMIN', 'LEADER', 'WORKER'],
  '/deployment': ['ADMIN', 'LEADER'],
  '/jobs':       ['ADMIN', 'LEADER'],
  '/team':       ['ADMIN'],
  '/reports':    ['ADMIN'],
};

function getDefaultRouteForRole(role: UserRole | null): string {
  if (role === 'WORKER') return '/tracking';
  if (role === 'LEADER') return '/deployment';
  return '/dashboard';
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { userProfile, isUserLoading } = useAuth();
  const router   = useRouter();
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const userRole     = userProfile?.role as UserRole | null ?? null;

  const allowedRoles = Object.entries(ROUTE_ROLE_ACCESS)
    .find(([route]) => pathname.startsWith(route))?.[1] ?? null;
  const isRoleAllowed = !allowedRoles || (userRole !== null && allowedRoles.includes(userRole));

  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!isUserLoading) { setTimedOut(false); return; }
    if (isPublicPath) return;
    const id = setTimeout(() => setTimedOut(true), AUTH_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [isUserLoading, isPublicPath]);

  useEffect(() => {
    if (timedOut && !isPublicPath) { router.replace('/'); return; }
    if (!isUserLoading && !userProfile && !isPublicPath) { router.replace('/'); return; }
    if (!isUserLoading && userProfile && !isPublicPath && !isRoleAllowed) {
      router.replace(getDefaultRouteForRole(userRole)); return;
    }
    if (!isUserLoading && userProfile && isPublicPath) {
      router.replace(getDefaultRouteForRole(userRole));
    }
  }, [userProfile, userRole, isRoleAllowed, isUserLoading, isPublicPath, router, timedOut]);

  if (isPublicPath) {
    if (!isUserLoading && userProfile) return <LoadingScreen message="Weiterleitung..." />;
    return <>{children}</>;
  }
  if (timedOut)      return <LoadingScreen message="Sitzung abgelaufen — Weiterleitung..." />;
  if (isUserLoading) return <LoadingScreen message="Authentifizierung läuft..." />;
  if (!userProfile)  return <LoadingScreen message="Kein Zugriff — Weiterleitung..." />;
  if (!isRoleAllowed)return <LoadingScreen message="Keine Berechtigung — Weiterleitung..." />;

  return <>{children}</>;
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <Loader2 className="animate-spin w-10 h-10 text-primary" />
      <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">{message}</p>
    </div>
  );
}
