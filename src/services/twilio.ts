import twilio from 'twilio';
import { prisma } from '../lib/prisma';
import logger from '../lib/logger';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const fromNumber = process.env.TWILIO_PHONE_NUMBER || '';
const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || '';
const BASE_URL = process.env.BASE_URL || 'https://leadseize-backend-production.up.railway.app';

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [2000, 2000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < delays.length) {
        logger.warn(`[${label}] Attempt ${attempt + 1} failed, retrying in ${delays[attempt]}ms`, { err });
        await new Promise((r) => setTimeout(r, delays[attempt]));
      } else {
        logger.error(`[${label}] All ${delays.length + 1} attempts failed`, { err });
        throw err;
      }
    }
  }
  throw new Error('unreachable');
}

export async function sendSms(to: string, body: string): Promise<string> {
  return withRetry(
    async () => {
      const message = await client.messages.create({ from: fromNumber, to, body });
      return message.sid;
    },
    'Twilio.sendSms'
  );
}

export async function makeCall(to: string, twimlUrl: string): Promise<string> {
  const call = await client.calls.create({ from: fromNumber, to, url: twimlUrl });
  return call.sid;
}

export async function sendWhatsApp(to: string, body: string): Promise<string> {
  return withRetry(
    async () => {
      const message = await client.messages.create({
        from: `whatsapp:${fromWhatsApp}`,
        to: `whatsapp:${to}`,
        body,
      });
      return message.sid;
    },
    'Twilio.sendWhatsApp'
  );
}

export async function provisionPhoneNumber(agentId: string): Promise<string> {
  const available = await client.availablePhoneNumbers('US').local.list({ limit: 1 });

  if (!available.length) {
    throw new Error('[Twilio] No US local phone numbers available to purchase');
  }

  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    smsUrl: `${BASE_URL}/webhooks/twilio/sms`,
    smsMethod: 'POST',
    voiceUrl: `${BASE_URL}/webhooks/twilio/voice`,
    voiceMethod: 'POST',
  });

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      twilioPhone: purchased.phoneNumber,
      twilioSid: purchased.sid,
    },
  });

  logger.info(`[Twilio] Provisioned ${purchased.phoneNumber} for agent ${agentId}`);
  return purchased.phoneNumber;
}
