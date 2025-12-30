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

let mailerReadyPromise: Promise<boolean> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);

    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(fallback);
      }
    );
  });
}

function ensureTransporter(): Promise<boolean> {
  if (mailerReady) return Promise.resolve(true);
  if (mailerReadyPromise) return mailerReadyPromise;

  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;

  if (!host || !portRaw || !user || !pass || !from) {
    mailerError =
      'SMTP is not fully configured (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM). Notifications are disabled.';
    console.warn(mailerError);
    mailerReadyPromise = Promise.resolve(false);
    return mailerReadyPromise;
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

  mailerReadyPromise = new Promise<boolean>((resolve) => {
    transporter!.verify((err) => {
      if (err) {
        mailerError = `Failed to verify SMTP transporter: ${err.message || String(err)}`;
        console.error(mailerError);
        transporter = null;
        resolve(false);
        return;
      }
      mailerReady = true;
      console.log('SMTP transporter for notifications is ready');
      resolve(true);
    });
  });

  return mailerReadyPromise;
}

export async function sendNotificationMail(payload: NotificationPayload): Promise<void> {
  // Wait a short time for SMTP verify on the *first* send attempt.
  const ready = await withTimeout(ensureTransporter(), 3000, false);

  if (!ready || !transporter || !mailerReady) {
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
