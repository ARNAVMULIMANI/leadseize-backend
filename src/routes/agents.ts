import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { scrapeBusinessInfo } from '../services/scraper';
import { provisionPhoneNumber } from '../services/twilio';
import { requireAuth, AuthRequest } from '../middleware/auth';
import logger from '../lib/logger';

const router = Router();

function signToken(agentId: string): string {
  const secret = process.env.JWT_SECRET!;
  return jwt.sign({ agentId }, secret, { expiresIn: '7d' });
}

// Fire scraping and phone provisioning in the background after agent creation
function runPostCreateJobs(agentId: string, websiteUrl: string): void {
  scrapeBusinessInfo(websiteUrl)
    .then(async (info) => {
      const parts: string[] = [];
      if (info.name) parts.push(`Business: ${info.name}`);
      if (info.phone) parts.push(`Phone: ${info.phone}`);
      if (info.email) parts.push(`Email: ${info.email}`);
      if (info.address) parts.push(`Address: ${info.address}`);
      await prisma.agent.update({
        where: { id: agentId },
        data: { scrapedContext: parts.join('\n') },
      });
    })
    .catch((err) => logger.error('[Agents] Scrape failed', { websiteUrl, err }));

  provisionPhoneNumber(agentId)
    .catch((err) => logger.error('[Agents] Phone provisioning failed', { agentId, err }));
}

// POST /agents/register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, websiteUrl, businessDescription, alertEmail, alertPhone, password } = req.body;

    if (!password) {
      res.status(400).json({ error: 'password is required' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const agent = await prisma.agent.create({
      data: { name, email, phone, websiteUrl, businessDescription, alertEmail, alertPhone, passwordHash },
    });

    runPostCreateJobs(agent.id, websiteUrl);

    const token = signToken(agent.id);
    const { passwordHash: _, ...agentSafe } = agent;
    res.status(201).json({ agent: agentSafe, token });
  } catch (err) {
    next(err);
  }
});

// POST /agents/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { email } });

    if (!agent || !agent.passwordHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, agent.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signToken(agent.id);
    const { passwordHash: _, ...agentSafe } = agent;
    res.json({ agent: agentSafe, token });
  } catch (err) {
    next(err);
  }
});

// POST /agents — unauthenticated create (legacy / admin use)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, websiteUrl, businessDescription, alertEmail, alertPhone } = req.body;

    const agent = await prisma.agent.create({
      data: { name, email, phone, websiteUrl, businessDescription, alertEmail, alertPhone },
    });

    runPostCreateJobs(agent.id, websiteUrl);

    const { passwordHash: _, ...agentSafe } = agent;
    res.status(201).json({ agent: agentSafe });
  } catch (err) {
    next(err);
  }
});

// GET /agents/:id/status — protected dashboard summary
router.get('/:id/status', requireAuth, async (req: AuthRequest & Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [totalLeads, qualifiedLeads, weekLeads] = await Promise.all([
      prisma.lead.count({ where: { agentId: agent.id } }),
      prisma.lead.count({
        where: {
          agentId: agent.id,
          OR: [{ status: 'handoff' }, { score: { gte: 70 } }],
        },
      }),
      prisma.lead.count({
        where: { agentId: agent.id, createdAt: { gte: startOfWeek } },
      }),
    ]);

    const { passwordHash: _, ...agentSafe } = agent;
    res.json({
      agent: agentSafe,
      phone: agent.twilioPhone,
      whatsappEnabled: agent.whatsappEnabled,
      stats: { totalLeads, qualifiedLeads, weekLeads },
    });
  } catch (err) {
    next(err);
  }
});

// GET /agents/:id — protected
router.get('/:id', requireAuth, async (req: AuthRequest & Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { leads: true } } },
    });

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const { passwordHash: _, ...agentSafe } = agent;
    res.json({ agent: agentSafe });
  } catch (err) {
    next(err);
  }
});

// PUT /agents/:id — protected
router.put('/:id', requireAuth, async (req: AuthRequest & Request<{ id: string }>, res: Response, next: NextFunction) => {
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

    const { passwordHash: _, ...agentSafe } = agent;
    res.json({ agent: agentSafe });
  } catch (err) {
    next(err);
  }
});

export default router;
