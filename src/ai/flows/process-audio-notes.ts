'use server';
/**
 * @fileOverview This file defines a Genkit flow for processing audio notes.
 * It transcribes the audio into text and then summarizes the transcribed text.
 *
 * - processAudioNotes - A function that orchestrates the transcription and summarization of audio notes.
 * - AudioNoteInput - The input type for the processAudioNotes function, containing the audio data URI.
 * - AudioNoteOutput - The return type for the processAudioNotes function, containing the transcription and summary.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Define the input schema for the audio note processing flow.
const AudioNoteInputSchema = z.object({
  audioDataUri: z
    .string()
    .describe(
      "The audio note as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'. The MIME type should be a valid audio type (e.g., audio/mpeg, audio/wav)."
    ),
});
export type AudioNoteInput = z.infer<typeof AudioNoteInputSchema>;

// Define the output schema for the audio note processing flow.
const AudioNoteOutputSchema = z.object({
  transcription: z.string().describe('The full transcribed text of the audio note.'),
  summary: z.string().describe('A concise summary of the transcribed audio note.'),
});
export type AudioNoteOutput = z.infer<typeof AudioNoteOutputSchema>;

// Wrapper function to call the Genkit flow.
export async function processAudioNotes(input: AudioNoteInput): Promise<AudioNoteOutput> {
  return processAudioNotesFlow(input);
}

// Define the Genkit flow for processing audio notes.
const processAudioNotesFlow = ai.defineFlow(
  {
    name: 'processAudioNotesFlow',
    inputSchema: AudioNoteInputSchema,
    outputSchema: AudioNoteOutputSchema,
  },
  async (input) => {
    // Extract the MIME type from the data URI for the media part.
    const audioContentType = input.audioDataUri.split(';')[0].split(':')[1];

    // Step 1: Transcribe the audio note using a multimodal model.
    const transcriptionResult = await ai.generate({
      model: 'googleai/gemini-1.5-flash',
      prompt: [
        {
          media: {
            url: input.audioDataUri,
            contentType: audioContentType,
          },
        },
        {
          text: 'Transcribe the provided audio note into text verbatim.',
        },
      ],
      config: {
        temperature: 0.1, // Keep temperature low for accurate transcription
      },
    });

    const transcription = transcriptionResult.text;
    if (!transcription) {
      throw new Error('Failed to transcribe audio note.');
    }

    // Step 2: Summarize the transcribed text.
    const summaryResult = await ai.generate({
      model: 'googleai/gemini-1.5-flash',
      prompt: `Summarize the following text in a concise and clear manner, focusing on key details, tasks performed, and any important observations or actions described in the job notes:\n\n${transcription}`,
      config: {
        temperature: 0.3, // A slightly higher temperature for summarization to allow some creativity but maintain factual accuracy
      },
    });

    const summary = summaryResult.text;
    if (!summary) {
      throw new Error('Failed to summarize transcription.');
    }

    return { transcription, summary };
  }
);
