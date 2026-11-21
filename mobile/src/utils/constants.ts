import { hasKey, t, type Key } from '@/i18n';
export const COLORS = {
  primary:    '#0f2850',
  primaryLight:'#1a3d70',
  accent:     '#cd3915',
  success:    '#16a34a',
  warning:    '#f59e0b',
  danger:     '#dc2626',
  bg:         '#f0f4f8',
  card:       '#ffffff',
  border:     '#e2e8f0',
  text:       '#1e293b',
  textMuted:  '#64748b',
  textLight:  '#94a3b8',
  white:      '#ffffff',
};

export const STATUS_COLORS: Record<string, string> = {
  PENDING:     COLORS.warning,
  IN_PROGRESS: '#3b82f6',
  COMPLETED:   COLORS.success,
  OPEN:        COLORS.warning,
  SUBMITTED:   '#8b5cf6',
  APPROVED:    COLORS.success,
  REJECTED:    COLORS.danger,
};

export const CATEGORY_LABELS: Record<string, string> = {
  // Service catalog of the web app (src/lib/services.ts)
  AR_Oeffen:       'Außengehwege',
  AR_Hof:          'Hofbereich',
  Gullis:          'Gullis',
  Ablaufrinnen:    'Ablaufrinnen',
  AR_Laub:         'Laub AR',
  Rasen_Fl1:       'Rasen Fl. 1',
  Rasen_Fl2:       'Rasen Fl. 2',
  Gittersteine:    'Gittersteine',
  Gartenpflege:    'Gartenpflege',
  Baeume_Pruefen:  'Bäume prüfen',
  VEG_Laub:        'Laub VEG',
  WINTERDIENST:    'Winterdienst',
  MAENGEL:         'Mängelbeseitigung',
  // Older codes
  AUSSENREINIGUNG: 'Außenreinigung',
  GULLIS:          'Gullis',
  RASSEN_MAEHEN:   'Rasen mähen',
  GARTEN_PFLEGE:   'Gartenpflege',
  BAEUME_PRUEFEN:  'Bäume prüfen',
  LAUBAUFNAHME:    'Laubaufnahme',
};

/** Display name of a service code, including company-defined "custom_…" services. */
export function categoryLabel(code: string): string {
  const key = `svc.${code}` as Key;
  if (hasKey(key)) return t(key);
  if (CATEGORY_LABELS[code]) return CATEGORY_LABELS[code];
  if (code.startsWith('custom_')) {
    const words = code.slice('custom_'.length).replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return code;
}

export const GPS_RADIUS_METERS = 300;
