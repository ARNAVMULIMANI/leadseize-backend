import { getOpenAIClient } from '../lib/openai';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function generateResponse(prompt: string, systemPrompt?: string): Promise<string> {
  const response = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      { role: 'user', content: prompt },
    ],
  });

  return response.choices[0]?.message?.content || '';
}

export async function chat(messages: ChatMessage[]): Promise<string> {
  const response = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o',
    messages,
  });

  return response.choices[0]?.message?.content || '';
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
