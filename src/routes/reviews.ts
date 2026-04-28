import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { generateResponse } from '../services/ai';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

const RESPOND_SYSTEM_PROMPT =
  'You are a professional reputation manager for a real estate agent. Write a short, warm, professional response to this Google review. If it\'s a positive review, thank them and mention their experience. If it\'s a negative review (rating 1-3), acknowledge their concern professionally, apologize, and offer to resolve it offline. Keep it under 100 words. Never be defensive.';

router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { agentId } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'agentId query param is required' });
      return;
    }

    const reviews = await prisma.googleReview.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ reviews });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { agentId, reviewerName, rating, reviewText } = req.body;

    const aiResponse = await generateResponse(
      `Write a professional, warm response to this ${rating}-star Google review from ${reviewerName}: "${reviewText}". Keep it under 150 words, thank them personally, and address any specific feedback they mentioned.`,
      'You are a business owner responding to Google reviews. Be genuine, brief, and professional.'
    );

    const review = await prisma.googleReview.create({
      data: { agentId, reviewerName, rating, reviewText, aiResponse },
    });

    res.status(201).json({ review });
  } catch (err) {
    next(err);
  }
});

router.post('/respond/:id', requireAuth, async (req: AuthRequest & Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const review = await prisma.googleReview.findUnique({
      where: { id: req.params.id },
    });

    if (!review) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    const aiResponse = await generateResponse(
      `${review.rating}-star review from ${review.reviewerName}: "${review.reviewText}"`,
      RESPOND_SYSTEM_PROMPT
    );

    const updated = await prisma.googleReview.update({
      where: { id: review.id },
      data: { aiResponse, status: 'responded', respondedAt: new Date() },
    });

    res.json({ review: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
