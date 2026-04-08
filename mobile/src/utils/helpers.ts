/** Haversine distance in meters between two GPS coordinates */
export function gpsDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function elapsedMinutes(fromIso: string): number {
  return Math.floor((Date.now() - new Date(fromIso).getTime()) / 60000);
}

export function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Convert image URI to base64 data-URL */
export async function uriToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob     = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}
