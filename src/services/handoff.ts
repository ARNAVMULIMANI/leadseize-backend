import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma';
import { analyzeLeadIntent } from './ai';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface HandoffPayload {
  leadName: string;
  leadPhone: string;
  leadEmail?: string;
  summary: string;
  qualificationScore: number;
  toEmail: string;
}

export async function sendHandoffAlert(payload: HandoffPayload): Promise<void> {
  await transporter.sendMail({
    from: process.env.ALERT_FROM_EMAIL,
    to: payload.toEmail,
    subject: `Hot Lead Ready for Handoff: ${payload.leadName}`,
    html: `
      <h2>Lead Handoff Alert</h2>
      <p><strong>Name:</strong> ${payload.leadName}</p>
      <p><strong>Phone:</strong> ${payload.leadPhone}</p>
      ${payload.leadEmail ? `<p><strong>Email:</strong> ${payload.leadEmail}</p>` : ''}
      <p><strong>Qualification Score:</strong> ${payload.qualificationScore}/100</p>
      <h3>Conversation Summary</h3>
      <p>${payload.summary}</p>
    `,
  });
}

const HANDOFF_SCORE_THRESHOLD = 70;

export async function checkAndTriggerHandoff(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      agent: true,
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });

  // Skip if already handed off or no messages to analyze
  if (lead.status === 'handoff' || lead.messages.length === 0) return;

  const transcript = lead.messages
    .map((m) => `${m.role === 'lead' ? 'Lead' : 'Agent'}: ${m.content}`)
    .join('\n');

  const { intent, score } = await analyzeLeadIntent(transcript);

  await prisma.lead.update({
    where: { id: leadId },
    data: { score, summary: intent },
  });

  if (score >= HANDOFF_SCORE_THRESHOLD) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'handoff' },
    });

    await sendHandoffAlert({
      leadName: lead.fromName || lead.fromNumber,
      leadPhone: lead.fromNumber,
      summary: intent,
      qualificationScore: score,
      toEmail: lead.agent.alertEmail,
    });

    console.log(`[Handoff] Lead ${leadId} handed off — score ${score}`);
  }
}
