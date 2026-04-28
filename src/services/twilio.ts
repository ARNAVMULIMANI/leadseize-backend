import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const fromNumber = process.env.TWILIO_PHONE_NUMBER || '';
const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || '';

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
