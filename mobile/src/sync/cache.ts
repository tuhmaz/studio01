/**
 * Lokaler Zwischenspeicher für das, was der Mitarbeiter auch ohne Netz sehen
 * muss: heutige Einsätze, Objekte, offener Zeiteintrag, Checklisten.
 * Pro Benutzer getrennt; jeder Eintrag merkt sich, wann er geladen wurde.
 */
import * as FileSystem from 'expo-file-system/legacy';

const DIR = `${FileSystem.documentDirectory}cache/`;

export interface Cached<T> {
  savedAt: string;
  data: T;
}

const path = (key: string) => `${DIR}${key.replace(/[^A-Za-z0-9_-]+/g, '_')}.json`;

export async function saveCache<T>(key: string, data: T): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(path(key), JSON.stringify({ savedAt: new Date().toISOString(), data }));
  } catch {
    // Zwischenspeicher ist Komfort, kein Muss.
  }
}

export async function loadCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const info = await FileSystem.getInfoAsync(path(key));
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(path(key))) as Cached<T>;
  } catch {
    return null;
  }
}

/** Zwischenspeicher eines Benutzers löschen (Abmelden). */
export async function clearCache(): Promise<void> {
  await FileSystem.deleteAsync(DIR, { idempotent: true });
}
