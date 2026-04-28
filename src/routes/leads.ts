import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agentId } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'agentId query param is required' });
      return;
    }

    const leads = await prisma.lead.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });

    res.json({ leads });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json({ lead });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/status', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;

    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json({ lead });
  } catch (err) {
    next(err);
  }
});

export default router;
