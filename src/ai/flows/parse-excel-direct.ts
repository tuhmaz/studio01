/**
 * محلل مباشر لملف Tourplan Excel - بدون ذكاء اصطناعي
 * يقرأ ألوان الخلايا مباشرة من XML داخل ZIP بدلاً من الاعتماد على SheetJS لقراءة الأنماط.
 */

import * as XLSX from 'xlsx';
import { calculateAnnualCount } from './parse-excel-plan-shared';

// ─── ثوابت ────────────────────────────────────────────────────────────────────

const MONTHLY_SHEET_NAMES = [
  'Jan.', 'Feb. ', 'Mär.', 'Apr.', 'Mai', 'Jun.',
  'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'
] as const;

const SERVICE_CODES = [
  'AR_Oeffen', 'AR_Hof', 'Gullis', 'Ablaufrinnen',
  'AR_Laub', 'Rasen_Fl1', 'Rasen_Fl2', 'Gittersteine',
  'Gartenpflege', 'Baeume_Pruefen', 'VEG_Laub',
] as const;

// خريطة الأعمدة في ورقة Häufigkeit (0-indexed)
const HAEUFIGKEIT_COLS: Record<string, number> = {
  AR_Oeffen: 3, AR_Hof: 4, Gullis: 5, Ablaufrinnen: 6,
  AR_Laub: 7, Rasen_Fl1: 8, Rasen_Fl2: 9, Gittersteine: 10,
  Gartenpflege: 11, Baeume_Pruefen: 12, VEG_Laub: 13,
};

// العمود الأيسر (نص التكرار) في الأوراق الشهرية (0-indexed)
const MONTHLY_LEFT_COLS: Record<string, number> = {
  AR_Oeffen: 3, AR_Hof: 5, Gullis: 7, Ablaufrinnen: 9,
  AR_Laub: 11, Rasen_Fl1: 13, Rasen_Fl2: 15, Gittersteine: 17,
  Gartenpflege: 19, Baeume_Pruefen: 21, VEG_Laub: 23,
};

// العمود الأيمن (لون التعبئة = نشط) في الأوراق الشهرية (0-indexed)
const MONTHLY_RIGHT_COLS: Record<string, number> = {
  AR_Oeffen: 4, AR_Hof: 6, Gullis: 8, Ablaufrinnen: 10,
  AR_Laub: 12, Rasen_Fl1: 14, Rasen_Fl2: 16, Gittersteine: 18,
  Gartenpflege: 20, Baeume_Pruefen: 22, VEG_Laub: 24,
};

/**
 * ألوان التعبئة التي تدل على نشاط الخدمة في الشهر (ARGB بدون # أو THEME_X)
 * مستخرجة من تحليل excel_output_full.txt و styles.xml
 */
const ACTIVE_FILL_COLORS = new Set([
  'FF0432FF', // أزرق   → AR_Oeffen, AR_Hof, Gullis, Ablaufrinnen (Gullis sometimes uses blue but mostly black)
  'FF009051', // أخضر   → Rasen_Fl1, Rasen_Fl2
  'FF92D050', // أخضر فاتح → Gittersteine
  'FFC00000', // أحمر   → Gartenpflege
  'FF945200', // بني    → Baeume_Pruefen
  'FFFFC000', // أصفر   → AR_Laub, VEG_Laub
  'THEME_1',  // أسود (Theme) → Gullis, Ablaufrinnen
  'FF000000', // أسود (RGB)   → Gullis, Ablaufrinnen
]);

// ─── قراءة ZIP (xlsx) مباشرة من الذاكرة ────────────────────────────────────

function readLE32(d: Uint8Array, p: number): number {
  return ((d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0);
}

/** فك ضغط ملف واحد من داخل ZIP باستخدام DecompressionStream المدمج في المتصفح */
async function readZipEntry(data: Uint8Array, target: string): Promise<string | null> {
  let pos = 0;
  while (pos + 30 < data.length) {
    if (data[pos] !== 0x50 || data[pos + 1] !== 0x4B ||
        data[pos + 2] !== 0x03 || data[pos + 3] !== 0x04) {
      pos++; continue;
    }
    const compression = data[pos + 8] | (data[pos + 9] << 8);
    const cmpSize = readLE32(data, pos + 18);
    const fnLen = data[pos + 26] | (data[pos + 27] << 8);
    const extLen = data[pos + 28] | (data[pos + 29] << 8);
    const name = new TextDecoder().decode(data.subarray(pos + 30, pos + 30 + fnLen));
    const dataStart = pos + 30 + fnLen + extLen;

    if (name === target) {
      const payload = data.subarray(dataStart, dataStart + cmpSize);
      if (compression === 0) {
        return new TextDecoder('utf-8').decode(payload);
      }
      if (compression === 8) {
        try {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();
          writer.write(payload as any); writer.close();
          const chunks: Uint8Array[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          let total = 0;
          for (const c of chunks) total += c.length;
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { out.set(c, off); off += c.length; }
          return new TextDecoder('utf-8').decode(out);
        } catch { return null; }
      }
    }
    pos = dataStart + cmpSize;
  }
  return null;
}

/** استخراج مصفوفة ألوان التعبئة من styles.xml (مفهرسة بـ fillId) */
function parseFillColors(stylesXml: string): string[] {
  const fills: string[] = [];
  const section = stylesXml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? '';
  for (const m of section.matchAll(/<fill>([\s\S]*?)<\/fill>/g)) {
    const fillInner = m[1];
    let colorKey = '';
    
    const rgbMatch = fillInner.match(/fgColor[^>]+rgb="([0-9A-Fa-f]{6,8})"/);
    if (rgbMatch) {
      colorKey = rgbMatch[1].toUpperCase();
    } else {
      const themeMatch = fillInner.match(/fgColor[^>]+theme="(\d+)"/);
      if (themeMatch) {
        colorKey = `THEME_${themeMatch[1]}`;
      }
    }
    fills.push(colorKey);
  }
  return fills;
}

/** استخراج مصفوفة xf (styleId → fillId) من styles.xml */
function parseXfs(stylesXml: string): number[] {
  const xfs: number[] = [];
  const section = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  for (const m of section.matchAll(/<xf\b([^>]*)/g)) {
    const fillId = parseInt(m[1].match(/fillId="(\d+)"/)?.[1] ?? '0');
    xfs.push(fillId);
  }
  return xfs;
}

/** قراءة ربط أسماء الأوراق بمسارات ملفاتها من workbook.xml وworkbook.xml.rels */
async function resolveSheetPaths(rawData: Uint8Array, sheetNames: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const wbXml = await readZipEntry(rawData, 'xl/workbook.xml');
  const relsXml = await readZipEntry(rawData, 'xl/_rels/workbook.xml.rels');
  if (!wbXml || !relsXml) return map;

  const rIdToFile = new Map<string, string>();
  for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
    // Target مثل "worksheets/sheet3.xml" بدون xl/ في البداية
    rIdToFile.set(m[1], m[2].replace(/^\.\.\//, ''));
  }

  for (const m of wbXml.matchAll(/<sheet\b[^>]+name="([^"]+)"[^>]+r:id="([^"]+)"/g)) {
    const name = m[1];
    const matchingSheetName = sheetNames.find(s => s.trim() === name.trim());
    if (matchingSheetName) {
      const rel = rIdToFile.get(m[2]) ?? '';
      if (rel) map.set(name, `xl/${rel}`);
    }
  }
  return map;
}

/**
 * البناء الرئيسي: يقرأ من خام xlsx ويعيد خريطة
 * sheetName → مجموعة عناوين الخلايا النشطة (ذات لون تعبئة محدد)
 */
async function buildActiveCellsMap(
  rawData: Uint8Array,
  sheetNames: readonly string[]
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();

  const stylesXml = await readZipEntry(rawData, 'xl/styles.xml');
  if (!stylesXml) return result;

  const fills = parseFillColors(stylesXml); // fillId → rgb
  const xfs = parseXfs(stylesXml);         // styleId → fillId

  // أي styleId يقابل لون نشط؟
  const activeStyleIds = new Set<number>();
  for (let i = 0; i < xfs.length; i++) {
    const fillId = xfs[i];
    if (fillId < fills.length && ACTIVE_FILL_COLORS.has(fills[fillId])) {
      activeStyleIds.add(i);
    }
  }

  const sheetPaths = await resolveSheetPaths(rawData, [...sheetNames]);

  for (const sName of sheetNames) {
    const path = sheetPaths.get(sName);
    if (!path) continue;
    const sheetXml = await readZipEntry(rawData, path);
    if (!sheetXml) continue;

    const activeCells = new Set<string>();
    // ابحث عن كل خلية تحمل سمة s="N" حيث N في activeStyleIds
    for (const m of sheetXml.matchAll(/<c\b([^>]*>)/g)) {
      const tag = m[1];
      const addr = tag.match(/\br="([A-Z]+\d+)"/)?.[1];
      const sId = tag.match(/\bs="(\d+)"/)?.[1];
      if (addr && sId && activeStyleIds.has(parseInt(sId))) {
        activeCells.add(addr);
      }
    }
    result.set(sName, activeCells);
  }

  return result;
}

// ─── أدوات مساعدة ────────────────────────────────────────────────────────────

function isValidId(val: any): boolean {
  if (val == null) return false;
  return /^\d+$/.test(String(val).trim());
}

function normalizeId(val: any): string {
  return String(val).trim().padStart(2, '0');
}

function parseCityField(raw: string | null): { postalCode: string; city: string } {
  if (!raw) return { postalCode: '', city: '' };
  const m = raw.trim().match(/^(\d{5})\s+(.+)$/);
  if (m) return { postalCode: m[1], city: m[2] };
  return { postalCode: '', city: raw.trim() };
}

function cellVal(row: any[], idx: number): string | null {
  const v = row[idx];
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// ─── الواجهة العامة ──────────────────────────────────────────────────────────

export interface ParsedSite {
  id: string;
  region: 'LR-39' | 'LR-38';
  routeCode: 'LR-39' | 'LR-38';
  city: string;
  postalCode: string;
  address: string;
  name: string;
  isRemote: boolean;
  distanceFromHQ: number;
  estimatedTravelTimeMinutesFromHQ: number;
  services: Record<string, {
    isActive: boolean;
    frequency: string | null;
    annualCount: number | null;
    months: string[];
  }>;
}

/**
 * تحليل ملف Excel مباشرة.
 * @param workbook الكتاب المُحلَّل بـ SheetJS (للحصول على القيم النصية)
 * @param rawData البيانات الخام للملف (Uint8Array) لقراءة ألوان الخلايا مباشرة من XML
 */
export async function parseExcelDirect(
  workbook: XLSX.WorkBook,
  rawData: Uint8Array
): Promise<ParsedSite[]> {
  const sitesMap = new Map<string, ParsedSite>();

  // ─── الخطوة 1: قراءة ورقة Häufigkeit (نصية، تعمل مع SheetJS) ───
  const hwSheet = workbook.Sheets['Häufigkeit'];
  if (hwSheet) {
    const rows = XLSX.utils.sheet_to_json(hwSheet, {
      header: 1, defval: null, raw: false,
    }) as any[][];

    for (const row of rows) {
      if (!isValidId(row[0])) continue;

      const id = normalizeId(row[0]);
      const { postalCode, city } = parseCityField(cellVal(row, 1));
      const address = cellVal(row, 2) || '';
      const region: 'LR-39' | 'LR-38' = postalCode.startsWith('38') ? 'LR-38' : 'LR-39';

      const services: ParsedSite['services'] = {};
      for (const code of SERVICE_CODES) {
        const freq = cellVal(row, HAEUFIGKEIT_COLS[code]);
        services[code] = {
          isActive: freq != null,
          frequency: freq,
          annualCount: freq != null ? calculateAnnualCount(freq) : null,
          months: [],
        };
      }

      let distanceFromHQ = 0;
      let estimatedTravelTimeMinutesFromHQ = 0;
      let isRemote = false;

      try {
        const query = [address, city, postalCode, 'Deutschland'].filter(Boolean).join(', ');
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=de`;
        const res = await fetch(url, { headers: { 'User-Agent': 'HausmeisterPro/1.0' } });
        const data = await res.json();

        if (data && data.length > 0) {
          const siteLat = parseFloat(data[0].lat);
          const siteLng = parseFloat(data[0].lon);

          const hqLat = 52.0189651;
          const hqLng = 11.7265854;

          const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${hqLng},${hqLat};${siteLng},${siteLat}?overview=false`;
          const osrmRes = await fetch(osrmUrl);
          const osrmData = await osrmRes.json();

          if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
            const distanceMeters = osrmData.routes[0].distance;
            const durationSeconds = osrmData.routes[0].duration;

            distanceFromHQ = parseFloat((distanceMeters / 1000).toFixed(1));
            estimatedTravelTimeMinutesFromHQ = Math.round(durationSeconds / 60);
            
            if (distanceFromHQ > 95) {
              isRemote = true;
              estimatedTravelTimeMinutesFromHQ += 60; // +1 Std. bei > 95km
            }
          }
        }
        // Nominatim Rate-Limit einhalten (max 1 Request pro Sekunde)
        await new Promise(r => setTimeout(r, 1100));
      } catch (e) {
        console.error("Route calc failed for", city, e);
        // Auch bei Fehler kurz warten
        await new Promise(r => setTimeout(r, 1100));
      }

      sitesMap.set(id, {
        id, region, routeCode: region, city, postalCode, address,
        name: `${address}, ${city}`,
        isRemote,
        distanceFromHQ,
        estimatedTravelTimeMinutesFromHQ,
        services,
      });
    }
  }

  // ─── الخطوة 2: بناء خريطة الخلايا النشطة من XML مباشرة ───
  const activeCellsMap = await buildActiveCellsMap(rawData, MONTHLY_SHEET_NAMES);

  // ─── الخطوة 3: قراءة الأوراق الشهرية باستخدام الخريطة ───
  for (const actualSheetName of workbook.SheetNames) {
    const matchingSheetName = MONTHLY_SHEET_NAMES.find(s => s.trim() === actualSheetName.trim());
    if (!matchingSheetName) continue;

    const ws = workbook.Sheets[actualSheetName];
    if (!ws || !ws['!ref']) continue;

    const activeCells = activeCellsMap.get(matchingSheetName) ?? new Set<string>();
    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let r = range.s.r; r <= range.e.r; r++) {
      let site: ParsedSite | undefined;

      // 1. محاولة المطابقة عبر اسم المدينة والعنوان (لأن الـ IDs قد تتغير في أوراق الأشهر)
      const cityCell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
      const addressCell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
      const rowCityField = cityCell?.v ? String(cityCell.v).trim() : '';
      const rowAddress = addressCell?.v ? String(addressCell.v).trim() : '';

      if (rowCityField || rowAddress) {
        const { city } = parseCityField(rowCityField);
        site = Array.from(sitesMap.values()).find(s => 
          s.city.toLowerCase() === city.toLowerCase() && 
          s.address.toLowerCase() === rowAddress.toLowerCase()
        );
      }

      // 2. إذا لم يتم العثور عليه، نعود للبحث بواسطة الـ ID كخيار بديل
      if (!site) {
        const idCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
        if (isValidId(idCell?.v)) {
          const id = normalizeId(idCell.v);
          const candidate = sitesMap.get(id);
          
          if (candidate) {
            // نقبل المطابقة بالـ ID فقط إذا كانت المدينة أو العنوان فارغاً أو يشبه البيانات الموجودة
            if (!rowCityField && !rowAddress) {
              site = candidate;
            } else {
              const { city } = parseCityField(rowCityField);
              if (
                candidate.city.toLowerCase().includes(city.toLowerCase()) || 
                candidate.address.toLowerCase().includes(rowAddress.toLowerCase())
              ) {
                site = candidate;
              }
            }
          }
        }
      }

      if (!site) continue;

      for (const code of SERVICE_CODES) {
        const rightAddr = XLSX.utils.encode_cell({ r, c: MONTHLY_RIGHT_COLS[code] });

        if (activeCells.has(rightAddr)) {
          const monthKey = matchingSheetName.trim();
          const svc = site.services[code];
          if (!svc.months.includes(monthKey)) svc.months.push(monthKey);

          if (!svc.isActive) {
            svc.isActive = true;
            const leftAddr = XLSX.utils.encode_cell({ r, c: MONTHLY_LEFT_COLS[code] });
            const leftCell = ws[leftAddr];
            const freqVal = leftCell?.v != null ? String(leftCell.v).trim() : null;
            svc.frequency = svc.frequency ?? (freqVal || null);
            svc.annualCount = svc.annualCount ?? (freqVal ? calculateAnnualCount(freqVal) : null);
          }
        }
      }
    }
  }

  return Array.from(sitesMap.values());
}
