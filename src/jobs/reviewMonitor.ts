import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { generateResponse } from '../services/ai';

const RESPOND_SYSTEM_PROMPT =
  'You are a professional reputation manager for a real estate agent. Write a short, warm, professional response to this Google review. If it\'s a positive review, thank them and mention their experience. If it\'s a negative review (rating 1-3), acknowledge their concern professionally, apologize, and offer to resolve it offline. Keep it under 100 words. Never be defensive.';

export function startReviewMonitor(): void {
  // Runs every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('[ReviewMonitor] Checking for pending reviews...');

    try {
      const pending = await prisma.googleReview.findMany({
        where: { status: 'pending', aiResponse: null },
      });

      if (pending.length === 0) {
        console.log('[ReviewMonitor] No pending reviews.');
        return;
      }

      for (const review of pending) {
        const aiResponse = await generateResponse(
          `${review.rating}-star review from ${review.reviewerName}: "${review.reviewText}"`,
          RESPOND_SYSTEM_PROMPT
        );

        await prisma.googleReview.update({
          where: { id: review.id },
          data: { aiResponse, status: 'responded', respondedAt: new Date() },
        });

        console.log(`[ReviewMonitor] Responded to review ${review.id} (${review.rating}★ from ${review.reviewerName})`);
      }
    } catch (err) {
      console.error('[ReviewMonitor] Error:', err);
    }
  });

  console.log('[ReviewMonitor] Monitor started (runs every 30 minutes)');
}
