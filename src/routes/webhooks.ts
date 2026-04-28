import { Router, Request, Response, NextFunction } from 'express';
import { validateTwilio } from '../middleware/validateTwilio';
import { prisma } from '../lib/prisma';
import { chat } from '../services/ai';
import { checkAndTriggerHandoff } from '../services/handoff';
import logger from '../lib/logger';

const router = Router();

// XML-escape text before embedding in TwiML
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twimlMessage(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`;
}

function buildIsaSystemPrompt(agentName: string, businessDescription: string, scrapedContext?: string | null): string {
  return `You are a friendly real estate ISA (Inside Sales Agent) texting on behalf of ${agentName}.

Business context: ${businessDescription}
${scrapedContext ? `Additional context: ${scrapedContext}` : ''}

Your job is to qualify inbound leads over SMS. Follow these rules without exception:

1. Be warm, natural, and conversational — write like a human texts, not like a form letter. Keep every reply to 1–3 short sentences.
2. Ask only ONE qualifying question per message. Never stack questions.
3. Work through these qualification topics in order, but only move to the next once the lead has answered the current one:
   a. Are they buying, selling, or both?
   b. What area or neighborhood are they interested in?
   c. What's their budget or price range?
   d. What's their timeline — are they looking to move in the next 30 days, 3 months, 6 months?
   e. If buying: are they already pre-approved for a mortgage?
4. Once all five topics are covered, let them know a team member will be reaching out shortly to help them personally. Do not promise a specific time.
5. If the lead goes off-topic, briefly acknowledge it, then gently guide them back to the next qualifying question.
6. Never reveal that you are an AI. If asked directly, say you're a member of the ${agentName} team.
7. Never discuss commission, fees, or make specific property recommendations.`;
}

// Shared handler for both SMS and WhatsApp inbound messages.
// fromNumber must already have any channel prefix stripped before calling.
async function handleInbound(
  fromNumber: string,
  incomingBody: string,
  channel: 'sms' | 'whatsapp',
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!fromNumber || !incomingBody) {
      res.type('text/xml').send(twimlMessage('Sorry, we could not process your message.'));
      return;
    }

    // Find existing lead (most recent, in case of duplicates) with agent + message history
    let lead = await prisma.lead.findFirst({
      where: { fromNumber },
      orderBy: { createdAt: 'desc' },
      include: {
        agent: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    // No prior conversation — find the first agent and create a new lead
    if (!lead) {
      const agent = await prisma.agent.findFirst();

      if (!agent) {
        res.type('text/xml').send(twimlMessage("Hi! Thanks for reaching out. We're not available right now but will be in touch soon."));
        return;
      }

      const created = await prisma.lead.create({
        data: { agentId: agent.id, channel, fromNumber },
      });

      lead = await prisma.lead.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          agent: true,
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });
    }

    // Persist the incoming lead message
    await prisma.message.create({
      data: { leadId: lead.id, role: 'lead', content: incomingBody },
    });

    // Build conversation history — lead.messages is pre-this-message state, so append the new one
    const history = lead.messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'lead' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));
    history.push({ role: 'user', content: incomingBody });

    const systemPrompt = buildIsaSystemPrompt(
      lead.agent.name,
      lead.agent.businessDescription,
      lead.agent.scrapedContext
    );

    const aiReply = await chat([{ role: 'system', content: systemPrompt }, ...history]);

    // Persist AI reply and update lead timestamp in parallel
    await Promise.all([
      prisma.message.create({
        data: { leadId: lead.id, role: 'ai', content: aiReply },
      }),
      prisma.lead.update({
        where: { id: lead.id },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    // Check qualification score and trigger handoff if threshold met — async, doesn't delay reply
    checkAndTriggerHandoff(lead.id).catch((err) =>
      logger.error(`[Webhooks/${channel}] Handoff check failed`, { err })
    );

    res.type('text/xml').send(twimlMessage(aiReply));
  } catch (err) {
    next(err);
  }
}

router.post('/twilio/sms', validateTwilio, (req: Request, res: Response, next: NextFunction) => {
  handleInbound(req.body.From, req.body.Body, 'sms', res, next);
});

router.post('/twilio/whatsapp', validateTwilio, (req: Request, res: Response, next: NextFunction) => {
  // Twilio prefixes WhatsApp numbers with "whatsapp:" — strip it before storing
  const rawFrom: string = req.body.From || '';
  const fromNumber = rawFrom.replace(/^whatsapp:/, '');
  handleInbound(fromNumber, req.body.Body, 'whatsapp', res, next);
});

router.post('/twilio/voice', validateTwilio, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Hello from LeadSeize.</Say></Response>');
  } catch (err) {
    next(err);
  }
});

export default router;
