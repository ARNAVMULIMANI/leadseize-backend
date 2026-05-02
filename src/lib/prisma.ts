import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import logger from './logger';
import nodemailer from 'nodemailer';

function createPrismaClient() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

async function sendDbFailureAlert(): Promise<void> {
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
      subject: '[LeadSeize CRITICAL] Database connection failed',
      text: 'The LeadSeize server could not connect to the database after 5 attempts and is exiting.',
    });
  } catch {
    // Best-effort only — can't log to DB either
  }
}

export async function connectWithRetry(): Promise<void> {
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 5000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info('[DB] Connected successfully');
      return;
    } catch (err) {
      logger.warn(`[DB] Connection attempt ${attempt}/${MAX_RETRIES} failed`, { err });
      if (attempt === MAX_RETRIES) {
        logger.error('[DB] All connection attempts failed — sending alert and exiting');
        await sendDbFailureAlert();
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}
