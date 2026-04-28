import twilio from 'twilio';
import { prisma } from '../lib/prisma';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const fromNumber = process.env.TWILIO_PHONE_NUMBER || '';
const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || '';
const BASE_URL = process.env.BASE_URL || 'https://leadseize-backend-production.up.railway.app';

export async function sendSms(to: string, body: string): Promise<string> {
  const message = await client.messages.create({ from: fromNumber, to, body });
  return message.sid;
}

export async function makeCall(to: string, twimlUrl: string): Promise<string> {
  const call = await client.calls.create({ from: fromNumber, to, url: twimlUrl });
  return call.sid;
}

export async function sendWhatsApp(to: string, body: string): Promise<string> {
  const message = await client.messages.create({
    from: `whatsapp:${fromWhatsApp}`,
    to: `whatsapp:${to}`,
    body,
  });
  return message.sid;
}

export async function provisionPhoneNumber(agentId: string): Promise<string> {
  // Find an available US local number
  const available = await client.availablePhoneNumbers('US').local.list({ limit: 1 });

  if (!available.length) {
    throw new Error('[Twilio] No US local phone numbers available to purchase');
  }

  // Purchase the number and point both webhooks at our server
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    smsUrl: `${BASE_URL}/webhooks/twilio/sms`,
    smsMethod: 'POST',
    voiceUrl: `${BASE_URL}/webhooks/twilio/voice`,
    voiceMethod: 'POST',
  });

  // Persist the new number on the agent record
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      twilioPhone: purchased.phoneNumber,
      twilioSid: purchased.sid,
    },
  });

  console.log(`[Twilio] Provisioned ${purchased.phoneNumber} for agent ${agentId}`);
  return purchased.phoneNumber;
}
