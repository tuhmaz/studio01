"use client";

/**
 * The signed-in user's company branding (name, platform name, logo), shared by
 * the sidebar, dashboard and page title. Loaded once per page load; the
 * settings page calls refreshCompanyBranding() after saving.
 */
import { useEffect, useState } from 'react';

export interface CompanyBranding {
  name: string;
  siteName: string | null;
  logoData: string | null;
}

const DEFAULT_PRODUCT_NAME = 'Hausmeister Pro';
const EVENT = 'company-branding-updated';

let cached: CompanyBranding | null = null;
let pending: Promise<CompanyBranding | null> | null = null;

async function load(): Promise<CompanyBranding | null> {
  try {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'query', table: 'companies', select: 'name,site_name,logo_data' }),
    });
    if (!res.ok) return null;
    const row = (await res.json())?.data?.[0];
    if (!row) return null;
    cached = { name: row.name ?? '', siteName: row.site_name || null, logoData: row.logo_data || null };
    return cached;
  } catch {
    return null;
  }
}

export function refreshCompanyBranding() {
  pending = load().then(result => {
    window.dispatchEvent(new window.Event(EVENT));
    return result;
  });
}

export function useCompanyBranding() {
  const [branding, setBranding] = useState<CompanyBranding | null>(cached);

  useEffect(() => {
    let active = true;
    pending ??= load();
    pending.then(result => { if (active) setBranding(result); });
    const onUpdate = () => { if (active) setBranding(cached); };
    window.addEventListener(EVENT, onUpdate);
    return () => {
      active = false;
      window.removeEventListener(EVENT, onUpdate);
    };
  }, []);

  return {
    branding,
    /** What the app calls itself for this company (Plattform-Name, else the product name). */
    productName: branding?.siteName || DEFAULT_PRODUCT_NAME,
    companyName: branding?.name || '',
  };
}
