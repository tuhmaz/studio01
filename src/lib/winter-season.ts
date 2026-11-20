/** Winter seasons run from 1 October to 30 April (dates in Europe/Berlin). */

export interface Season {
  startYear: number;
  label: string;
  from: Date;
  to: Date;
}

export function seasonOf(startYear: number): Season {
  return {
    startYear,
    label: `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`,
    // Midnight Berlin time is 22:00/23:00 UTC; one hour of margin covers both.
    from: new Date(Date.UTC(startYear, 8, 30, 22, 0, 0)),
    to: new Date(Date.UTC(startYear + 1, 3, 30, 22, 0, 0)),
  };
}

/** The season a date belongs to (May–September count toward the coming season). */
export function currentSeason(now = new Date()): Season {
  const month = now.getMonth(); // 0 = January
  return seasonOf(month >= 4 ? now.getFullYear() : now.getFullYear() - 1);
}

export function recentSeasons(count = 4, now = new Date()): Season[] {
  const current = currentSeason(now).startYear;
  return Array.from({ length: count }, (_, i) => seasonOf(current - i));
}
