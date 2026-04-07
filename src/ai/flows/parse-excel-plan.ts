'use server';
/**
 * @fileOverview KI-Agent zur präzisen monatlichen Indizierung von Tourplänen via Together AI.
 * Erkennt Häufigkeiten (4xJ, 1xW) und ordnet diese spezifischen Monaten zu.
 */

import Together from "together-ai";
import { ai } from '@/ai/genkit';
import { 
  ParseExcelPlanInputSchema, 
  ParseExcelPlanOutputSchema, 
  ParseExcelPlanInput, 
  ParseExcelPlanOutput,
  JobSiteFromPlan,
  ServiceCode,
  SERVICE_CODES,
  calculateAnnualCount,
  normalizeMonth
} from './parse-excel-plan-shared';

const together = new Together({
  apiKey: process.env.TOGETHER_AI_API_KEY,
});

export async function parseExcelPlan(input: ParseExcelPlanInput): Promise<ParseExcelPlanOutput> {
  return parseExcelPlanFlow(input);
}

const parseExcelPlanFlow = ai.defineFlow(
  {
    name: 'parseExcelPlanFlow',
    inputSchema: ParseExcelPlanInputSchema,
    outputSchema: ParseExcelPlanOutputSchema,
  },
  async (input) => {
    const activeMonth = normalizeMonth(input.sheetName);
    const isMonthSheet = activeMonth !== null;
    
    let columnInstructions = "";
    if (isMonthSheet) {
      columnInstructions = `
      DIES IST EIN MONATSBLATT (${input.sheetName}). 
      Analysiere die Spalten basierend auf den Markierungen (X, 1, 2, '01' etc.):
      Index 0: ID
      Index 1: Ort
      Index 2: Adresse
      Index 3: AR_Oeffen (Öffen.)
      Index 5: AR_Hof (N.Öffen.)
      Index 7: Gullis
      Index 9: Ablaufrinnen (Passvant.)
      Index 11: AR_Laub (aufnahme)
      Index 13: Rasen_Fl1 (Fl. 1)
      Index 15: Rasen_Fl2 (Fl. 2)
      Index 17: Gittersteine (mähen)
      Index 19: Gartenpflege (Pflege)
      Index 21: Baeume_Pruefen (Prüfen)
      Index 23: VEG_Laub (aufnahme)
      
      Regel: Wenn eine Zelle an einem dieser Indizes NICHT LEER ist, setze isActive: true und füge "${input.sheetName}" zum Array "months" hinzu.`;
    } else {
      columnInstructions = `
      DIES IST DAS HAUPTBLATT (Häufigkeit).
      Extrahiere die Häufigkeit (z.B. "4 X J", "1 X W"):
      Index 0: ID
      Index 1: Ort
      Index 2: Adresse
      Index 3: AR_Oeffen
      Index 4: AR_Hof
      Index 5: Gullis
      Index 6: Ablaufrinnen
      Index 7: AR_Laub
      Index 8: Rasen_Fl1
      Index 9: Rasen_Fl2
      Index 10: Gittersteine
      Index 11: Gartenpflege
      Index 12: Baeume_Pruefen
      Index 13: VEG_Laub`;
    }

    const prompt = `Du bist ein hochpräziser Daten-Extraktor für Hausmeister-Leistungsverzeichnisse.
    Analysiere das Blatt "${input.sheetName}" und extrahiere alle Zeilen, die mit einer Objektnummer (ID) beginnen.
    
    ${columnInstructions}

    DATEN (JSON):
    ${input.rawRows}

    ANTWORTE AUSSCHLIESSLICH ALS JSON: { "sites": [{ "id": "...", "city": "...", "address": "...", "services": { "SERVICE_CODE": { "isActive": boolean, "frequency": "...", "annualCount": number, "months": ["..."] } } }] }.
    Verwende exakt diese Keys für services: ${SERVICE_CODES.join(', ')}.`;

    try {
      const response = await together.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "Du bist ein JSON-API-Endpunkt. Antworte nur mit validem JSON. Alle Schema-Felder (isActive, frequency, annualCount, months) müssen IMMER vorhanden sein."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: "json_object" }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Keine Antwort von Together AI.");
      
      const parsed = JSON.parse(content) as ParseExcelPlanOutput;
      
      const processedSites: JobSiteFromPlan[] = (parsed.sites || []).map((site) => {
        const cleanedServices = {} as JobSiteFromPlan['services'];
        
        SERVICE_CODES.forEach((code) => {
          const serviceCode = code as ServiceCode;
          const s = site.services?.[serviceCode] || { isActive: false };
          
          if (s && s.isActive) {
            const months = Array.isArray(s.months) ? s.months : [];
            if (isMonthSheet && !months.includes(input.sheetName)) {
              months.push(input.sheetName);
            }

            cleanedServices[serviceCode] = {
              isActive: true,
              frequency: s.frequency || null,
              annualCount: s.annualCount || calculateAnnualCount(s.frequency),
              months: months.map((month: string) => month.trim()).filter(Boolean)
            };
          } else {
            cleanedServices[serviceCode] = {
              isActive: false,
              frequency: null,
              annualCount: null,
              months: []
            };
          }
        });

        return { 
          ...site, 
          region: (site.id && String(site.id).startsWith('38')) ? 'LR-38' : 'LR-39',
          isRemote: site.isRemote ?? false,
          services: cleanedServices 
        };
      });

      return { sites: processedSites };
    } catch (error: unknown) {
      console.error("Analysis Error:", error);
      throw new Error(`KI-Fehler bei Blatt ${input.sheetName}: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
    }
  }
);
