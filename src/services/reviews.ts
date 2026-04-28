import { sendSms } from './twilio';

export async function requestReview(phone: string, businessName: string, reviewUrl: string): Promise<void> {
  const message = `Hi! Thanks for choosing ${businessName}. We'd love your feedback — it only takes 30 seconds: ${reviewUrl}`;
  await sendSms(phone, message);
}
