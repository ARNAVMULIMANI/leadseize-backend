import './env'; // Must be first — loads .env before any other module runs
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import agentsRouter from './routes/agents';
import webhooksRouter from './routes/webhooks';
import leadsRouter from './routes/leads';
import reviewsRouter from './routes/reviews';
import { errorHandler } from './middleware/errorHandler';
import { startNurtureScheduler } from './jobs/nurtureScheduler';
import { startReviewMonitor } from './jobs/reviewMonitor';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    methods: ['GET', 'POST'],
  },
});

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3001' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/agents', agentsRouter);
app.use('/webhooks', webhooksRouter);
app.use('/leads', leadsRouter);
app.use('/reviews', reviewsRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(errorHandler);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startNurtureScheduler();
  startReviewMonitor();
});

export { io };
