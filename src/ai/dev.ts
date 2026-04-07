
import { config } from 'dotenv';
config();

import '@/ai/flows/generate-report-summary.ts';
import '@/ai/flows/process-audio-notes.ts';
import '@/ai/flows/parse-excel-plan.ts';
