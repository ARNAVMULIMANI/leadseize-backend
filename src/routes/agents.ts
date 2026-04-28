import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { scrapeBusinessInfo } from '../services/scraper';

const router = Router();

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, websiteUrl, businessDescription, alertEmail, alertPhone } = req.body;

    const agent = await prisma.agent.create({
      data: { name, email, phone, websiteUrl, businessDescription, alertEmail, alertPhone },
    });

    // Scrape in background so the response isn't blocked
    scrapeBusinessInfo(websiteUrl)
      .then(async (info) => {
        const parts: string[] = [];
        if (info.name) parts.push(`Business: ${info.name}`);
        if (info.phone) parts.push(`Phone: ${info.phone}`);
        if (info.email) parts.push(`Email: ${info.email}`);
        if (info.address) parts.push(`Address: ${info.address}`);
        await prisma.agent.update({
          where: { id: agent.id },
          data: { scrapedContext: parts.join('\n') },
        });
      })
      .catch((err) => console.error('[Agents] Scrape failed for', websiteUrl, err));

    res.status(201).json({ agent });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { leads: true } } },
    });

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json({ agent });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, websiteUrl, businessDescription, alertEmail, alertPhone,
            twilioSid, twilioToken, twilioPhone, whatsappEnabled } = req.body;

    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(websiteUrl !== undefined && { websiteUrl }),
        ...(businessDescription !== undefined && { businessDescription }),
        ...(alertEmail !== undefined && { alertEmail }),
        ...(alertPhone !== undefined && { alertPhone }),
        ...(twilioSid !== undefined && { twilioSid }),
        ...(twilioToken !== undefined && { twilioToken }),
        ...(twilioPhone !== undefined && { twilioPhone }),
        ...(whatsappEnabled !== undefined && { whatsappEnabled }),
      },
    });

    res.json({ agent });
  } catch (err) {
    next(err);
  }
});

export default router;
