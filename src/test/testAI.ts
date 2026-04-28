import 'dotenv/config';
import { generateResponse } from '../services/ai';

const systemPrompt =
  'You are a helpful ISA (Inside Sales Agent) for a real estate agent. Your job is to qualify leads naturally and conversationally. Ask only one question at a time. Find out their budget, timeline, whether they are buying or selling, their preferred location, and if they are pre-approved for a mortgage. Be warm, friendly and concise. Never reveal you are an AI unless directly asked.';

const conversation = [
  { role: 'user', content: "Hi I saw your listing on Zillow, I'm interested" },
];

async function main() {
  const leadMessage = conversation[conversation.length - 1].content;

  console.log('--- Incoming lead message ---');
  console.log(leadMessage);
  console.log('\n--- AI response ---');

  const response = await generateResponse(leadMessage, systemPrompt);
  console.log(response);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
