/** Winterdienst labels, shared by server and browser code. */

export const ACTIVITIES = {
  clearing: 'Räumen',
  gritting: 'Streuen',
  clearing_gritting: 'Räumen + Streuen',
  inspection: 'Kontrolle (kein Einsatz nötig)',
} as const;
export type Activity = keyof typeof ACTIVITIES;

export const MATERIALS = {
  salt: 'Streusalz',
  grit: 'Splitt',
  sand: 'Sand',
  granulate: 'Granulat',
  mixed: 'Gemisch',
} as const;
export type Material = keyof typeof MATERIALS;

/** Tätigkeiten, bei denen das Streumittel Pflicht ist. */
export const NEEDS_MATERIAL: Activity[] = ['gritting', 'clearing_gritting'];
