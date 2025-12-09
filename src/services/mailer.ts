import 'dotenv/config';
import nodemailer from 'nodemailer';

export type NotificationKind = 'lead' | 'donation' | 'booking' | 'feedback';

export interface NotificationPayload {
  kind: NotificationKind;
  projectName: string;
  projectSlug: string;
  to: string[];
  subject: string;
  text: string;
}

let transporter: nodemailer.Transporter | null = null;
let mailerReady = false;
let mailerError: string | null = null;

function ensureTransporter() {
  if (transporter || mailerReady) {
    return;
  }

  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;

  if (!host || !portRaw || !user || !pass || !from) {
    mailerError =
      'SMTP is not fully configured (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM). Notifications are disabled.';
    console.warn(mailerError);
    return;
  }

  const port = Number(portRaw) || 587;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  transporter.verify((err) => {
    if (err) {
      mailerError = `Failed to verify SMTP transporter: ${err.message || String(err)}`;
      console.error(mailerError);
      transporter = null;
      return;
    }
    mailerReady = true;
    console.log('SMTP transporter for notifications is ready');
  });
}

export async function sendNotificationMail(payload: NotificationPayload): Promise<void> {
  ensureTransporter();

  if (!transporter || !mailerReady) {
    if (mailerError) {
      console.warn('Notifications are disabled due to SMTP error:', mailerError);
    } else {
      console.warn('Notifications are disabled (no SMTP config)');
    }
    console.log('[Notification mock]', payload);
    return;
  }

  if (!payload.to || payload.to.length === 0) {
    console.warn('Notification skipped: no recipients', payload.kind);
    return;
  }

  const from = process.env.SMTP_FROM || payload.to[0];

  try {
    await transporter.sendMail({
      from,
      to: payload.to.join(','),
      subject: payload.subject,
      text: payload.text,
    });
  } catch (err: any) {
    console.error('Failed to send notification email', err);
  }
}
