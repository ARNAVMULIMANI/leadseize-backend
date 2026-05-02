import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import logger from '../lib/logger';

const router = Router();

const SCOPES = ['https://www.googleapis.com/auth/business.manage'];
const RATING_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

const RESPOND_SYSTEM_PROMPT =
  "You are a professional reputation manager for a real estate agent. Write a short, warm, professional response to this Google review. If it's positive, thank them and mention their experience. If it's negative (rating 1-3), acknowledge their concern professionally, apologize, and offer to resolve it offline. Keep it under 100 words. Never be defensive.";

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// GET /google/auth/:agentId — redirect to Google OAuth consent screen
router.get('/auth/:agentId', async (req: Request<{ agentId: string }>, res: Response, next: NextFunction) => {
  try {
    const { agentId } = req.params;
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const oauth2Client = getOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: agentId,
    });

    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

// GET /google/callback — handle OAuth redirect, save tokens
router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state: agentId, error } = req.query;

    if (error) {
      res.status(400).json({ error: `Google OAuth denied: ${error}` });
      return;
    }

    if (!code || typeof code !== 'string' || !agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    await prisma.agent.update({
      where: { id: agentId },
      data: {
        googleAccessToken: tokens.access_token ?? undefined,
        googleRefreshToken: tokens.refresh_token ?? undefined,
      },
    });

    logger.info(`[Google] OAuth tokens saved for agent ${agentId}`);
    res.json({
      success: true,
      message: 'Google Business account connected. Set googleLocationId on your agent record, then call /google/reviews/sync/:agentId to import reviews.',
    });
  } catch (err) {
    next(err);
  }
});

// POST /google/reviews/sync/:agentId — fetch latest reviews from GMB and save to DB
router.post('/reviews/sync/:agentId', async (req: Request<{ agentId: string }>, res: Response, next: NextFunction) => {
  try {
    const { agentId } = req.params;
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });

    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (!agent.googleAccessToken) {
      res.status(400).json({ error: 'Google account not connected — call /google/auth/:agentId first' });
      return;
    }
    if (!agent.googleLocationId) {
      res.status(400).json({ error: 'googleLocationId not set on agent — format: accounts/{accountId}/locations/{locationId}' });
      return;
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: agent.googleAccessToken,
      refresh_token: agent.googleRefreshToken ?? undefined,
    });

    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await prisma.agent.update({ where: { id: agentId }, data: { googleAccessToken: tokens.access_token } });
      }
    });

    const { token } = await oauth2Client.getAccessToken();
    if (!token) {
      res.status(401).json({ error: 'Could not obtain Google access token — re-authenticate via /google/auth/:agentId' });
      return;
    }

    const response = await axios.get(
      `https://mybusiness.googleapis.com/v4/${agent.googleLocationId}/reviews`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const reviews: Record<string, unknown>[] = response.data.reviews || [];
    let created = 0;

    for (const review of reviews) {
      const googleReviewId = review.name as string;
      if (!googleReviewId) continue;

      const exists = await prisma.googleReview.findFirst({ where: { agentId, googleReviewId } });
      if (exists) continue;

      const starRating = review.starRating as string;
      const reviewer = review.reviewer as Record<string, unknown> | undefined;

      await prisma.googleReview.create({
        data: {
          agentId,
          googleReviewId,
          reviewerName: (reviewer?.displayName as string | undefined) || 'Anonymous',
          rating: RATING_MAP[starRating] ?? 0,
          reviewText: (review.comment as string | undefined) || '',
          status: 'pending',
        },
      });
      created++;
    }

    logger.info(`[Google] Synced ${created} new reviews for agent ${agentId} (total from API: ${reviews.length})`);
    res.json({ synced: created, total: reviews.length });
  } catch (err) {
    next(err);
  }
});

// POST /google/reviews/respond/:agentId — post AI-generated responses back to GMB
router.post('/reviews/respond/:agentId', async (req: Request<{ agentId: string }>, res: Response, next: NextFunction) => {
  try {
    const { agentId } = req.params;
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });

    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (!agent.googleAccessToken) {
      res.status(400).json({ error: 'Google account not connected' });
      return;
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: agent.googleAccessToken,
      refresh_token: agent.googleRefreshToken ?? undefined,
    });

    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await prisma.agent.update({ where: { id: agentId }, data: { googleAccessToken: tokens.access_token } });
      }
    });

    const { token } = await oauth2Client.getAccessToken();
    if (!token) {
      res.status(401).json({ error: 'Could not obtain Google access token — re-authenticate via /google/auth/:agentId' });
      return;
    }

    // Find reviews that have an AI response generated but haven't been posted to Google yet
    const pending = await prisma.googleReview.findMany({
      where: {
        agentId,
        status: 'responded',
        aiResponse: { not: null },
        googleReviewId: { not: null },
      },
    });

    let posted = 0;
    let failed = 0;

    for (const review of pending) {
      if (!review.googleReviewId || !review.aiResponse) continue;

      try {
        await axios.put(
          `https://mybusiness.googleapis.com/v4/${review.googleReviewId}/reply`,
          { comment: review.aiResponse },
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );

        await prisma.googleReview.update({
          where: { id: review.id },
          data: { status: 'posted' },
        });

        posted++;
        logger.info(`[Google] Posted reply to review ${review.id} (${review.rating}★ from ${review.reviewerName})`);
      } catch (err) {
        failed++;
        logger.error(`[Google] Failed to post reply for review ${review.id}`, { err });
      }
    }

    res.json({ posted, failed, total: pending.length });
  } catch (err) {
    next(err);
  }
});

export { RESPOND_SYSTEM_PROMPT };
export default router;
