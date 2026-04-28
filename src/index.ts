import './env'; // Must be first — loads .env before any other module runs
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server } from 'socket.io';
import agentsRouter from './routes/agents';
import webhooksRouter from './routes/webhooks';
import leadsRouter from './routes/leads';
import reviewsRouter from './routes/reviews';
import { errorHandler } from './middleware/errorHandler';
import { generalLimiter, authLimiter, webhookLimiter } from './middleware/rateLimiter';
import { startNurtureScheduler } from './jobs/nurtureScheduler';
import { startReviewMonitor } from './jobs/reviewMonitor';
import logger from './lib/logger';
import nodemailer from 'nodemailer';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    methods: ['GET', 'POST'],
  },
});

// HTTP request logging via morgan → winston
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiters
app.use(generalLimiter);
app.use('/agents/register', authLimiter);
app.use('/agents/login', authLimiter);
app.use('/webhooks', webhookLimiter);

app.use('/agents', agentsRouter);
app.use('/webhooks', webhooksRouter);
app.use('/leads', leadsRouter);
app.use('/reviews', reviewsRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date() });
});

app.use(errorHandler);

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Critical error email alert
async function sendCriticalAlert(subject: string, message: string): Promise<void> {
  const alertEmail = process.env.ALERT_EMAIL || process.env.ALERT_FROM_EMAIL;
  if (!process.env.SMTP_HOST || !alertEmail) return;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.ALERT_FROM_EMAIL,
      to: alertEmail,
      subject: `[LeadSeize CRITICAL] ${subject}`,
      text: message,
    });
  } catch (err) {
    logger.error('Failed to send critical alert email', { err });
  }
}

// Global handlers — log and alert but keep the process alive
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error('Unhandled promise rejection', { reason: message });
  sendCriticalAlert('Unhandled Promise Rejection', message);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: err.stack || err.message });
  sendCriticalAlert('Uncaught Exception', err.stack || err.message);
});

const PORT = parseInt(process.env.PORT || '3000', 10);
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  startNurtureScheduler();
  startReviewMonitor();
});

export { io };
