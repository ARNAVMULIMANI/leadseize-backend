import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';

export function validateTwilio(req: Request, res: Response, next: NextFunction): void {
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const isValid = twilio.validateRequest(authToken, twilioSignature, url, req.body);

  if (!isValid) {
    res.status(403).json({ error: 'Invalid Twilio signature' });
    return;
  }

  next();
}
