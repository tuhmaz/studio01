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
  AUSSENREINIGUNG: 'Außenreinigung',
  GULLIS:          'Gullis',
  RASSEN_MAEHEN:   'Rasen mähen',
  GARTEN_PFLEGE:   'Gartenpflege',
  BAEUME_PRUEFEN:  'Bäume prüfen',
  LAUBAUFNAHME:    'Laubaufnahme',
};

export const GPS_RADIUS_METERS = 300;
