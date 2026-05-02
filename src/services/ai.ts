import { getOpenAIClient } from '../lib/openai';
import logger from '../lib/logger';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const AI_FALLBACK = "Thanks for reaching out! Our team will get back to you shortly.";

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  delays: number[],
  fallback: T
): Promise<T> {
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < delays.length) {
        logger.warn(`[${label}] Attempt ${attempt + 1} failed, retrying in ${delays[attempt]}ms`, { err });
        await new Promise((r) => setTimeout(r, delays[attempt]));
      } else {
        logger.error(`[${label}] All ${delays.length + 1} attempts failed, using fallback`, { err });
        return fallback;
      }
    }
  }
  return fallback;
}

export async function generateResponse(prompt: string, systemPrompt?: string): Promise<string> {
  return withRetry(
    () => getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
    }).then((r) => r.choices[0]?.message?.content || ''),
    'AI.generateResponse',
    [1000, 2000, 4000],
    AI_FALLBACK
  );
}

export async function chat(messages: ChatMessage[]): Promise<string> {
  return withRetry(
    () => getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages,
    }).then((r) => r.choices[0]?.message?.content || ''),
    'AI.chat',
    [1000, 2000, 4000],
    AI_FALLBACK
  );
}

export async function analyzeLeadIntent(transcript: string): Promise<{ intent: string; score: number }> {
  const result = await generateResponse(
    `Analyze this conversation transcript and determine the lead's intent and a qualification score 0-100.\nTranscript: ${transcript}\nRespond with JSON: {"intent": string, "score": number}`,
    'You are a sales AI that analyzes lead conversations.'
  );

  try {
    return JSON.parse(result);
  } catch {
    return { intent: 'unknown', score: 0 };
  }
}
