/**
 * Sprachen der Mitarbeiter-App.
 *
 *  - Wörterbuch je Sprache in ./locales; Deutsch ist die Vorlage. TypeScript
 *    erzwingt, dass jede Sprache jeden Schlüssel hat (Typ `Dict`).
 *  - Standard: Sprache des Handys, sonst Deutsch. Wahl im Profil, gespeichert
 *    auf dem Gerät.
 *  - Arabisch läuft von rechts nach links: beim Wechsel wird die Richtung
 *    gesetzt und die App einmal neu gestartet (React Native verlangt das).
 *  - Daten aus dem Büro (Objektnamen, Leistungsbezeichnungen, Meldungen des
 *    Servers) bleiben, wie sie dort eingegeben wurden.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';
import * as Updates from 'expo-updates';
import { de, type Dict, type Key } from './locales/de';
import { en } from './locales/en';
import { ar } from './locales/ar';
import { tr } from './locales/tr';
import { pl } from './locales/pl';
import { ro } from './locales/ro';
import { uk } from './locales/uk';

export type Lang = 'de' | 'en' | 'ar' | 'tr' | 'pl' | 'ro' | 'uk';
export type { Key };

export const LANGUAGES: Array<{ code: Lang; name: string; rtl?: boolean; locale: string }> = [
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'ar', name: 'العربية', rtl: true, locale: 'ar' },
  { code: 'tr', name: 'Türkçe', locale: 'tr-TR' },
  { code: 'pl', name: 'Polski', locale: 'pl-PL' },
  { code: 'ro', name: 'Română', locale: 'ro-RO' },
  { code: 'uk', name: 'Українська', locale: 'uk-UA' },
  { code: 'en', name: 'English', locale: 'en-GB' },
];

const DICTS: Record<Lang, Dict> = { de, en, ar, tr, pl, ro, uk };
const STORE_KEY = 'hp_lang';

let current: Lang = 'de';

export type Vars = Record<string, string | number>;

/** Text in der aktuellen Sprache; {name} wird ersetzt. Fehlt etwas, Deutsch. */
export function t(key: Key, vars?: Vars): string {
  const text = DICTS[current][key] ?? de[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`)) : text;
}

export function hasKey(key: string): key is Key {
  return key in de;
}

export function currentLang(): Lang {
  return current;
}

/** Locale für Datum/Uhrzeit (z. B. "pl-PL"); Arabisch mit westlichen Ziffern. */
export function dateLocale(): string {
  return current === 'ar' ? 'ar-u-nu-latn' : LANGUAGES.find(l => l.code === current)?.locale ?? 'de-DE';
}

function deviceLang(): Lang {
  const code = Localization.getLocales()[0]?.languageCode ?? 'de';
  return (Object.keys(DICTS) as Lang[]).includes(code as Lang) ? (code as Lang) : 'de';
}

const isRtl = (lang: Lang) => !!LANGUAGES.find(l => l.code === lang)?.rtl;

async function applyDirection(lang: Lang): Promise<boolean> {
  const rtl = isRtl(lang);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  try {
    await Updates.reloadAsync();
  } catch {
    // In der Entwicklung (Expo Go) ggf. kein Reload – greift beim nächsten Start.
  }
  return true;
}

interface I18nState {
  lang: Lang;
  ready: boolean;
  setLang: (lang: Lang) => Promise<void>;
  t: typeof t;
}

const I18nContext = createContext<I18nState>({ lang: 'de', ready: false, setLang: async () => {}, t });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('de');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      let stored: Lang | null = null;
      try {
        stored = (await SecureStore.getItemAsync(STORE_KEY)) as Lang | null;
      } catch { /* ignore */ }
      const lang = stored && stored in DICTS ? stored : deviceLang();
      current = lang;
      setLangState(lang);
      // Richtung muss zur Sprache passen (z. B. nach Neuinstallation).
      const reloading = await applyDirection(lang);
      if (!reloading) setReady(true);
    })();
  }, []);

  const setLang = useCallback(async (next: Lang) => {
    await SecureStore.setItemAsync(STORE_KEY, next);
    current = next;
    setLangState(next);
    await applyDirection(next);
  }, []);

  // `lang` im Wert sorgt dafür, dass alle Bildschirme bei einem Wechsel neu zeichnen.
  const value = useMemo(() => ({ lang, ready, setLang, t }), [lang, ready, setLang]);
  // key={lang}: bei Sprachwechsel alles neu aufbauen – so funktioniert `t()` auch
  // außerhalb von Komponenten (Alerts, Hilfsfunktionen) ohne Hook.
  return (
    <I18nContext.Provider value={value}>
      {ready ? <React.Fragment key={lang}>{children}</React.Fragment> : null}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

/** Braucht die gewählte Sprache einen Neustart (Richtungswechsel)? */
export function needsRestart(lang: Lang) {
  return I18nManager.isRTL !== isRtl(lang);
}

/** Pfeil-Icons in Rechts-nach-links-Sprachen spiegeln (Layout dreht sich, Icons nicht). */
export const rtlFlip = I18nManager.isRTL ? { transform: [{ scaleX: -1 as const }] } : undefined;
