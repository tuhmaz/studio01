/**
 * Texte der Benachrichtigungen in den Sprachen der Mitarbeiter-App.
 *
 * Gespeichert werden nur `kind` + `data`; der Text entsteht beim Senden (Push in
 * der Sprache des Geräts) bzw. beim Abrufen (?lang=… der App, Web = Deutsch).
 * Deutsch ist die Vorlage, jede Sprache muss jede Art haben (Typ + Test).
 */
export const NOTIFY_LANGS = ['de', 'en', 'ar', 'tr', 'pl', 'ro', 'uk'] as const;
export type NotifyLang = (typeof NOTIFY_LANGS)[number];

export const NOTIFICATION_KINDS = [
  'assignment.new',
  'assignment.moved',
  'assignment.cancelled',
  'defect.new',
  'clockout.reminder',
  'clockout.office',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

type Text = { title: string; body: string };
type Texts = Record<NotificationKind, Text>;

/*
 * Platzhalter:
 *   assignment.*       {title} {date} (moved: {from} → {date})
 *   defect.new         {site} {client} {text}
 *   clockout.reminder  {site} {since} {hours}
 *   clockout.office    {names} {site} {since} {hours}
 */
const de: Texts = {
  'assignment.new': { title: 'Neuer Einsatz', body: '{title} · {date}' },
  'assignment.moved': { title: 'Einsatz verschoben', body: '{title}: {from} → {date}' },
  'assignment.cancelled': { title: 'Einsatz entfällt', body: '{title} · {date}' },
  'defect.new': { title: 'Neue Mängelmeldung', body: '{site} ({client}): {text}' },
  'clockout.reminder': { title: 'Noch eingestempelt', body: '{site}: seit {since} ({hours} h). Bitte ausstempeln.' },
  'clockout.office': { title: 'Offene Arbeitszeit', body: '{names} · {site}: eingestempelt seit {since} ({hours} h)' },
};

const en: Texts = {
  'assignment.new': { title: 'New assignment', body: '{title} · {date}' },
  'assignment.moved': { title: 'Assignment moved', body: '{title}: {from} → {date}' },
  'assignment.cancelled': { title: 'Assignment cancelled', body: '{title} · {date}' },
  'defect.new': { title: 'New defect report', body: '{site} ({client}): {text}' },
  'clockout.reminder': { title: 'Still clocked in', body: '{site}: since {since} ({hours} h). Please clock out.' },
  'clockout.office': { title: 'Open working time', body: '{names} · {site}: clocked in since {since} ({hours} h)' },
};

const ar: Texts = {
  'assignment.new': { title: 'مهمة جديدة', body: '{title} · {date}' },
  'assignment.moved': { title: 'تم تغيير موعد المهمة', body: '{title}: {from} ← {date}' },
  'assignment.cancelled': { title: 'تم إلغاء المهمة', body: '{title} · {date}' },
  'defect.new': { title: 'بلاغ عطل جديد', body: '{site} ({client}): {text}' },
  'clockout.reminder': { title: 'ما زلت مسجّل الدخول', body: '{site}: منذ {since} ({hours} ساعة). يرجى تسجيل الخروج.' },
  'clockout.office': { title: 'وقت عمل مفتوح', body: '{names} · {site}: مسجّل منذ {since} ({hours} ساعة)' },
};

const tr: Texts = {
  'assignment.new': { title: 'Yeni görev', body: '{title} · {date}' },
  'assignment.moved': { title: 'Görev ertelendi', body: '{title}: {from} → {date}' },
  'assignment.cancelled': { title: 'Görev iptal edildi', body: '{title} · {date}' },
  'defect.new': { title: 'Yeni arıza bildirimi', body: '{site} ({client}): {text}' },
  'clockout.reminder': { title: 'Hâlâ giriş yapılı', body: '{site}: {since} itibarıyla ({hours} sa). Lütfen çıkış yapın.' },
  'clockout.office': { title: 'Açık çalışma süresi', body: '{names} · {site}: {since} itibarıyla giriş yapılı ({hours} sa)' },
};

const pl: Texts = {
  'assignment.new': { title: 'Nowe zlecenie', body: '{title} · {date}' },
  'assignment.moved': { title: 'Zlecenie przeniesione', body: '{title}: {from} → {date}' },
  'assignment.cancelled': { title: 'Zlecenie odwołane', body: '{title} · {date}' },
  'defect.new': { title: 'Nowe zgłoszenie usterki', body: '{site} ({client}): {text}' },
  'clockout.reminder': { title: 'Nadal zarejestrowany', body: '{site}: od {since} ({hours} h). Zarejestruj wyjście.' },
  'clockout.office': { title: 'Otwarty czas pracy', body: '{names} · {site}: zarejestrowany od {since} ({hours} h)' },
};

const ro: Texts = {
  'assignment.new': { title: 'Sarcină nouă', body: '{title} · {date}' },
  'assignment.moved': { title: 'Sarcină mutată', body: '{title}: {from} → {date}' },
  'assignment.cancelled': { title: 'Sarcină anulată', body: '{title} · {date}' },
  'defect.new': { title: 'Sesizare nouă de defect', body: '{site} ({client}): {text}' },
  'clockout.reminder': { title: 'Încă pontat', body: '{site}: din {since} ({hours} h). Pontați ieșirea.' },
  'clockout.office': { title: 'Timp de lucru deschis', body: '{names} · {site}: pontat din {since} ({hours} h)' },
};

const uk: Texts = {
  'assignment.new': { title: 'Нове завдання', body: '{title} · {date}' },
  'assignment.moved': { title: 'Завдання перенесено', body: '{title}: {from} → {date}' },
  'assignment.cancelled': { title: 'Завдання скасовано', body: '{title} · {date}' },
  'defect.new': { title: 'Нове повідомлення про несправність', body: '{site} ({client}): {text}' },
  'clockout.reminder': { title: 'Досі на зміні', body: '{site}: з {since} ({hours} год). Відмітьте вихід.' },
  'clockout.office': { title: 'Відкритий робочий час', body: '{names} · {site}: на зміні з {since} ({hours} год)' },
};

export const NOTIFICATION_TEXTS: Record<NotifyLang, Texts> = { de, en, ar, tr, pl, ro, uk };

const LOCALES: Record<NotifyLang, string> = {
  de: 'de-DE', en: 'en-GB', ar: 'ar-u-nu-latn', tr: 'tr-TR', pl: 'pl-PL', ro: 'ro-RO', uk: 'uk-UA',
};

export function notifyLang(value: unknown): NotifyLang {
  return (NOTIFY_LANGS as readonly string[]).includes(String(value)) ? (value as NotifyLang) : 'de';
}

/** Werte mit Datum/Uhrzeit (Schlüssel date/from = YYYY-MM-DD, since = ISO) für die Sprache formatieren. */
function formatValue(key: string, value: unknown, lang: NotifyLang): string {
  const locale = LOCALES[lang];
  const text = String(value ?? '');
  if ((key === 'date' || key === 'from') && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T12:00:00Z`).toLocaleDateString(locale, {
      weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin',
    });
  }
  if (key === 'since' && !Number.isNaN(Date.parse(text))) {
    return new Date(text).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' });
  }
  return text;
}

export function renderNotification(kind: string, data: Record<string, unknown>, lang: NotifyLang = 'de'): Text {
  const texts = NOTIFICATION_TEXTS[lang] ?? de;
  const template = texts[kind as NotificationKind] ?? de[kind as NotificationKind];
  if (!template) return { title: kind, body: '' };
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => formatValue(k, data[k], lang));
  return { title: fill(template.title), body: fill(template.body).slice(0, 240) };
}
