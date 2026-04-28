import { sendSms } from './twilio';
import { generateResponse } from './ai';

export interface NurtureStep {
  delayDays: number;
  channel: 'sms' | 'email';
  templateKey: string;
}

export async function sendNurtureMessage(
  phone: string,
  leadName: string,
  businessContext: string
): Promise<void> {
  const message = await generateResponse(
    `Write a short, friendly follow-up SMS (under 160 chars) for a lead named ${leadName} from ${businessContext}. Be conversational, not salesy.`
  );

  await sendSms(phone, message);
}
