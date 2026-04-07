'use server';
/**
 * @fileOverview An AI agent that generates summaries of monthly work reports.
 *
 * - generateReportSummary - A function that handles the report summary generation process.
 * - GenerateReportSummaryInput - The input type for the generateReportSummary function.
 * - GenerateReportSummaryOutput - The return type for the generateReportSummary function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateReportSummaryInputSchema = z.object({
  monthlyReportData: z
    .string()
    .describe(
      'The comprehensive monthly work report data, which can include work hours, tasks completed, travel times, and other relevant metrics. This can be raw text or structured data.'
    ),
});
export type GenerateReportSummaryInput = z.infer<typeof GenerateReportSummaryInputSchema>;

const GenerateReportSummaryOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      'A concise overall summary of the team\'s performance for the month, highlighting key achievements and general trends.'
    ),
  kpis: z
    .array(z.string())
    .describe(
      'A list of key performance indicators (KPIs) identified from the report, such as total work hours, average task completion time, travel time efficiency, etc.'
    ),
  unusualEntries: z
    .array(z.string())
    .describe(
      'A list of any unusual time entries, attendance irregularities, or significant deviations from planned activities found in the report.'
    ),
  schedulingConflicts: z
    .array(z.string())
    .describe(
      'A list of potential or identified scheduling conflicts, bottlenecks, or areas for improved resource allocation based on the work plan and actual execution.'
    ),
});
export type GenerateReportSummaryOutput = z.infer<typeof GenerateReportSummaryOutputSchema>;

export async function generateReportSummary(input: GenerateReportSummaryInput): Promise<GenerateReportSummaryOutput> {
  return generateReportSummaryFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateReportSummaryPrompt',
  input: { schema: GenerateReportSummaryInputSchema },
  output: { schema: GenerateReportSummaryOutputSchema },
  prompt: `You are an expert business analyst specializing in workforce management and reporting. Your task is to analyze a monthly work report and provide a comprehensive summary, focusing on key performance indicators (KPIs), identifying any unusual activities, and highlighting potential scheduling conflicts.\n\nAnalyze the following monthly work report data:\n\nReport Data:\n{{{monthlyReportData}}}\n\nBased on the report, please provide:\n1.  A concise overall summary of the team's performance.\n2.  A list of key performance indicators (e.g., total work hours, average task duration, travel time efficiency).\n3.  Any unusual time entries, attendance irregularities, or significant deviations from planned activities.\n4.  Any identified or potential scheduling conflicts, bottlenecks, or areas for improved resource allocation.\n\nFormat your response as a JSON object matching the following schema, and make sure all array fields are present, even if empty:\n{{jsonSchema output}}`,
});

const generateReportSummaryFlow = ai.defineFlow(
  {
    name: 'generateReportSummaryFlow',
    inputSchema: GenerateReportSummaryInputSchema,
    outputSchema: GenerateReportSummaryOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
