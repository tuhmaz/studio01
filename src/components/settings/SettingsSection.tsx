"use client";

import React from 'react';
import { Label } from '@/components/ui/label';

// ─── Section wrapper ──────────────────────────────────────────────────────────

export function Section({
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

export function Field({
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

