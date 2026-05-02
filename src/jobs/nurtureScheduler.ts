import cron from 'node-cron';
import { sendNurtureMessage } from '../services/nurture';
import { prisma } from '../lib/prisma';
import logger from '../lib/logger';

export function startNurtureScheduler(): void {
  // Runs every day at 9am
  cron.schedule('0 9 * * *', async () => {
    logger.info('[NurtureScheduler] Running nurture job...');

    try {
      const now = new Date();

      const leads = await prisma.lead.findMany({
        where: {
          status: 'nurturing',
          nurtureSteps: {
            some: {
              status: 'pending',
              scheduledFor: { lte: now },
            },
          },
        },
        include: {
          agent: true,
          nurtureSteps: {
            where: {
              status: 'pending',
              scheduledFor: { lte: now },
            },
            orderBy: { stepNumber: 'asc' },
            take: 1,
          },
        },
      });

      for (const lead of leads) {
        const step = lead.nurtureSteps[0];
        if (!step) continue;

        try {
          await sendNurtureMessage(
            lead.fromNumber,
            lead.fromName || 'there',
            lead.agent.businessDescription
          );

          await prisma.nurtureStep.update({
            where: { id: step.id },
            data: { status: 'sent', sentAt: now },
          });

          logger.info(`[NurtureScheduler] Sent step ${step.stepNumber} to lead ${lead.id}`);
        } catch (err) {
          logger.error(`[NurtureScheduler] Failed to send step ${step.stepNumber} to lead ${lead.id}`, { err });
        }
      }
    } catch (err) {
      logger.error('[NurtureScheduler] Job error:', { err });
    }
  });

  logger.info('[NurtureScheduler] Scheduler started');
}
