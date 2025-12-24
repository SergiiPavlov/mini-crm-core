import express from 'express';
import { z, ZodError } from 'zod';
import rateLimit from 'express-rate-limit';
import prisma from '../db/client';
import { sendNotificationMail } from '../services/mailer';

const router = express.Router();


function computeContactName(name?: string, email?: string, phone?: string): string {
  const n = (name && name.trim()) || '';
  if (n) return n.slice(0, 255);
  const e = (email && email.trim()) || '';
  if (e) return e.slice(0, 255);
  const p = (phone && phone.trim()) || '';
  if (p) return p.slice(0, 255);
  return 'Unknown';
}


// ---------- Public rate limiting (platform safety) ----------
// Defaults:
// - GET config: 60/min per project+IP
// - POST submit: 10/min per project+IP
const publicConfigLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.PUBLIC_CONFIG_RL_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    const projectSlug = String((req as any).params?.projectSlug || 'unknown');
    return `${projectSlug}:${req.ip}:config`;
  },
});

const publicSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.PUBLIC_SUBMIT_RL_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    const projectSlug = String((req as any).params?.projectSlug || 'unknown');
    return `${projectSlug}:${req.ip}:submit`;
  },
});

function getHeader(req: any, name: string): string | undefined {
  const v = req.header(name);
  return v ? String(v).trim() : undefined;
}

function normalizePhone(raw?: string) {
  if (!raw) return undefined;
  const v = String(raw).trim();
  if (!v) return undefined;
  // keep digits and leading plus
  const cleaned = v.replace(/(?!^\+)\D+/g, '');
  return cleaned.length ? cleaned : undefined;
}

function normalizeText(raw?: string) {
  if (raw == null) return undefined;
  const v = String(raw).trim();
  return v ? v : undefined;
}

function isPrismaUniqueConstraintError(err: any): boolean {
  return Boolean(err && typeof err === 'object' && (err as any).code === 'P2002');
}


async function requirePublicProject(
  req: any,
  res: any,
  projectSlug: string
): Promise<{ id: number; publicKey: string } | null> {
  const projectKey = getHeader(req, 'X-Project-Key');
  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true, publicKey: true },
  });

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }

  if (!projectKey || projectKey !== project.publicKey) {
    res.status(403).json({ error: 'Invalid project key' });
    return null;
  }

  // Per-project Origin/Referer allowlist (defense-in-depth).
  // Note: CORS is already enforced in src/index.ts, but requests without Origin (curl/proxy) bypass CORS.
  const allowlist = await prisma.projectAllowedOrigin.findMany({
    where: { projectId: project.id },
    select: { origin: true },
  });

  if (allowlist.length > 0) {
    const origin = getHeader(req, 'Origin');
    const referer = getHeader(req, 'Referer');

    const allowed = allowlist.map((r) => r.origin);

    let refOrigin: string | undefined;
    if (referer) {
      try {
        refOrigin = new URL(referer).origin;
      } catch {
        refOrigin = undefined;
      }
    }

    const match = (origin && allowed.includes(origin)) || (refOrigin && allowed.includes(refOrigin));

    // If both headers are missing, allow GET (dev / server-to-server) but require explicit opt-in for POST.
    if (!origin && !refOrigin) {
      const allowNoOrigin = process.env.PUBLIC_ALLOW_NO_ORIGIN === '1';
      if (req.method === 'GET' || allowNoOrigin) {
        // ok
      } else {
        res.status(403).json({ error: 'Origin is required for this project (allowlist enabled)' });
        return null;
      }
    } else if (!match) {
      res.status(403).json({ error: 'Origin/Referer not allowed for this project' });
      return null;
    }
  }

  return project;
}


// Basic lead form (general contact/lead)
const publicLeadSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().email().max(255).optional(),
    phone: z.string().trim().max(30).optional(),
    message: z.string().trim().max(2000).optional(),
    source: z.string().trim().max(100).optional(),
    __hp: z.string().optional(),
  })
  .refine(
    (data) => data.name || data.email || data.phone,
    {
      message: 'At least one of name, email or phone is required',
      path: ['name'],
    }
  );

// Donation form
const publicDonationSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().email().max(255).optional(),
    phone: z.string().trim().max(30).optional(),
    amount: z
      .coerce
      .number()
      .positive('amount must be greater than 0')
      .max(1_000_000, 'amount is too large'),
    message: z.string().trim().max(2000).optional(),
    source: z.string().trim().max(100).optional(),
    __hp: z.string().optional(),
  })
  .refine(
    (data) => data.name || data.email || data.phone,
    {
      message: 'At least one of name, email or phone is required',
      path: ['name'],
    }
  );

// Booking form – для бронювань / записів (консультація, зустріч, послуга)
const publicBookingSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().email().max(255).optional(),
    phone: z.string().trim().max(30).optional(),
    service: z.string().trim().max(120).optional(),
    date: z.string().trim().max(50).optional(),
    time: z.string().trim().max(50).optional(),
    message: z.string().trim().max(2000).optional(),
    source: z.string().trim().max(100).optional(),
    __hp: z.string().optional(),
  })
  .refine(
    (data) => data.name || data.email || data.phone,
    {
      message: 'At least one of name, email or phone is required',
      path: ['name'],
    }
  );

// Feedback form – відгуки / звернення без грошей
const publicFeedbackSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().email().max(255).optional(),
    phone: z.string().trim().max(30).optional(),
    message: z.string().trim().max(2000),
    rating: z.coerce.number().min(1).max(5).optional(),
    source: z.string().trim().max(100).optional(),
    __hp: z.string().optional(),
  })
  .refine(
    (data) => data.name || data.email || data.phone,
    {
      message: 'At least one of name, email or phone is required',
      path: ['name'],
    }
  );


function getNotificationConfig(project: any) {
  const config = (project && (project as any).config) || {};
  const notifications = (config as any).notifications || {};
  const emails = Array.isArray(notifications.emails) ? notifications.emails : [];
  return {
    emails,
    notifyOnLead:
      typeof notifications.notifyOnLead === 'boolean' ? notifications.notifyOnLead : true,
    notifyOnDonation:
      typeof notifications.notifyOnDonation === 'boolean' ? notifications.notifyOnDonation : true,
    notifyOnBooking:
      typeof notifications.notifyOnBooking === 'boolean' ? notifications.notifyOnBooking : true,
    notifyOnFeedback:
      typeof notifications.notifyOnFeedback === 'boolean' ? notifications.notifyOnFeedback : true,
  };
}

function getTransactionCategoriesConfig(project: any) {
  const config = (project && (project as any).config) || {};
  const raw = (config as any).transactionCategories;

  const defaultCategories = [
    { code: 'donation', label: 'Пожертвування', color: '#3b82f6', type: 'income', order: 1 },
    { code: 'service', label: 'Послуга', color: '#22c55e', type: 'income', order: 2 },
    { code: 'refund', label: 'Повернення', color: '#ef4444', type: 'expense', order: 3 },
  ];

  if (!Array.isArray(raw) || raw.length === 0) {
    return defaultCategories;
  }

  const normalized = raw.map((cat: any, index: number) => {
    const code = typeof cat.code === 'string' && cat.code.trim() ? cat.code.trim() : defaultCategories[0].code;
    const label = typeof cat.label === 'string' && cat.label.trim() ? cat.label.trim() : code;
    const color = typeof cat.color === 'string' && cat.color.trim()
      ? cat.color.trim()
      : defaultCategories[0].color;
    const type = cat.type === 'expense' ? 'expense' : 'income';
    const order = typeof cat.order === 'number' ? cat.order : index + 1;

    return { code, label, color, type, order };
  });

  return normalized.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function pickProjectTransactionCategory(
  project: any,
  preferredCodes: string[] = [],
  preferredType: 'income' | 'expense' | 'any' = 'any'
) {
  const txCategories = getTransactionCategoriesConfig(project);
  if (!Array.isArray(txCategories) || txCategories.length === 0) {
    return null;
  }

  for (const code of preferredCodes) {
    if (!code) continue;
    const found = txCategories.find((cat) => cat.code === code);
    if (found) return found;
  }

  if (preferredType === 'income' || preferredType === 'expense') {
    const foundByType = txCategories.find((cat) => cat.type === preferredType);
    if (foundByType) return foundByType;
  }

  return txCategories[0];
}


// Public form config for widgets (title + active flag)
router.get('/forms/:projectSlug/:formKey/config', publicConfigLimiter, async (req, res) => {
  try {
    const { projectSlug, formKey } = req.params;

    const project = await requirePublicProject(req, res, projectSlug);

    if (!project) {
      return;
    }

    const publicForm = await prisma.publicForm.findFirst({
      where: {
        projectId: project.id,
        formKey,
      },
      select: { formKey: true, title: true, isActive: true },
    });

    if (!publicForm) {
      // Treat missing form as inactive (seed required)
      return res.status(404).json({ error: 'Form not found' });
    }

    return res.json({
      formKey: publicForm.formKey,
      title: publicForm.title,
      isActive: publicForm.isActive,
    });
  } catch (e) {
    console.error('[public] config error', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Unified handler for public forms
router.post('/forms/:projectSlug/:formKey', publicSubmitLimiter, async (req, res) => {
  try {
    const { projectSlug, formKey } = req.params;

    // ---- Public access guard (multi-site / multi-project) ----
    // Require valid X-Project-Key for any public form submit.
    const projectGuard = await requirePublicProject(req, res, projectSlug);
    if (!projectGuard) return;

    // ---- Idempotency ----
    // Widgets/sites can safely retry the same request (double-click, network retry)
    // by providing X-Request-Id (preferred) or X-Client-Request-Id.
    const clientRequestId =
      getHeader(req, 'X-Request-Id') ||
      getHeader(req, 'X-Client-Request-Id') ||
      (typeof (req.body as any)?.clientRequestId === 'string'
        ? String((req.body as any).clientRequestId).trim()
        : undefined);

    const normalizedClientRequestId = clientRequestId && clientRequestId.length <= 128
      ? clientRequestId
      : undefined;

    // Smoke runs should not send external notifications (avoids SMTP/Mailtrap throttling).
    const isSmokeRequest =
      getHeader(req, 'X-Smoke-Test') === '1' ||
      getHeader(req, 'X-Smoke-Test') === 'true' ||
      getHeader(req, 'X-Smoke') === '1';

    if (normalizedClientRequestId) {
      const existingCase = await prisma.case.findFirst({
        where: { projectId: projectGuard.id, clientRequestId: normalizedClientRequestId },
        include: { contact: true },
      });

      if (existingCase) {
        let tx: any = null;
        if (formKey === 'donation') {
          tx = await prisma.transaction.findFirst({
            where: { projectId: projectGuard.id, caseId: existingCase.id },
            orderBy: { id: 'desc' },
          });
        }
        return res.status(200).json({
          contact: existingCase.contact,
          case: existingCase,
          transaction: tx,
          idempotent: true,
        });
      }
    }

    // ----- LEAD -----
    if (formKey === 'lead') {
      const parsed = publicLeadSchema.parse(req.body);

      if (parsed.__hp && parsed.__hp.trim().length > 0) {
        console.warn('Honeypot triggered for project', projectSlug);
        return res.status(202).json({ received: true });
      }

      const name = normalizeText(parsed.name);
      const email = normalizeText(parsed.email);
      const phone = normalizePhone(parsed.phone);
      const message = normalizeText(parsed.message);
      const source = normalizeText(parsed.source);

      const project = await prisma.project.findUnique({
        where: { id: projectGuard.id },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const publicForm = await prisma.publicForm.findFirst({
        where: {
          projectId: project.id,
          formKey,
          isActive: true,
        },
      });

      
      if (!publicForm) {
        return res.status(410).json({ error: 'Form is disabled' });
      }

      if (normalizedClientRequestId) {
        const existing = await prisma.case.findFirst({
          where: {
            projectId: project.id,
            clientRequestId: normalizedClientRequestId,
          },
          include: { contact: true },
        });

        if (existing) {
          return res.status(200).json({
            contact: existing.contact,
            case: existing,
          });
        }
      }

      // Idempotency: return previously created entities for the same clientRequestId
      if (normalizedClientRequestId) {
        const existing = await prisma.case.findFirst({
          where: {
            projectId: project.id,
            clientRequestId: normalizedClientRequestId,
          },
          include: { contact: true },
        });

        if (existing) {
          return res.status(200).json({
            contact: existing.contact,
            case: existing,
          });
        }
      }

      const contact = await prisma.contact.create({
        data: {
          projectId: project.id,
          name: computeContactName(name, email, phone),
          email: email || null,
          phone: phone || null,
          notes: message || null,
        },
      });

	      let leadCase: any = null;
	      try {
	        leadCase = await prisma.case.create({
	          data: {
            projectId: project.id,
            contactId: contact.id,
            publicFormId: publicForm ? publicForm.id : null,
            clientRequestId: normalizedClientRequestId || null,
            title: 'Новий лід з сайту',
            description: message || null,
            status: 'new',
            source: source || 'widget',
          },
	        });
      } catch (caseError: any) {
        if (normalizedClientRequestId && isPrismaUniqueConstraintError(caseError)) {
          const existing = await prisma.case.findFirst({
            where: { projectId: project.id, clientRequestId: normalizedClientRequestId },
            include: { contact: true },
          });

          if (existing) {
            return res.status(200).json({
              contact: existing.contact,
              case: existing,
              idempotent: true,
            });
          }
        }

        console.error('Error creating case for lead', caseError);
        return res.status(500).json({ error: 'Failed to create case' });
      }

      const notifCfg = getNotificationConfig(project);
      if (!isSmokeRequest && notifCfg.notifyOnLead && notifCfg.emails.length) {
        const subject = `Новий лід з сайту — ${project.name}`;
        const lines: string[] = [];
        if (name) lines.push(`Ім'я: ${name}`);
        if (email) lines.push(`Email: ${email}`);
        if (phone) lines.push(`Телефон: ${phone}`);
        if (message) lines.push(`Повідомлення: ${message}`);
        if (source) lines.push(`Джерело: ${source}`);
        if (leadCase && leadCase.id) {
          lines.push(`Case ID: ${leadCase.id}`);
        }
        const text = lines.join('\n');
        await sendNotificationMail({
          kind: 'lead',
          projectName: project.name,
          projectSlug: project.slug,
          to: notifCfg.emails,
          subject,
          text,
        });
      }

      return res.status(201).json({
        contact,
        case: leadCase,
      });
    }

    // ----- DONATION -----
    if (formKey === 'donation') {
      const parsed = publicDonationSchema.parse(req.body);

      if (parsed.__hp && parsed.__hp.trim().length > 0) {
        console.warn('Honeypot (donation) triggered for project', projectSlug);
        return res.status(202).json({ received: true });
      }

      const name = normalizeText(parsed.name);
      const email = normalizeText(parsed.email);
      const phone = normalizePhone(parsed.phone);
      const amount = parsed.amount;
      const message = normalizeText(parsed.message);
      const source = normalizeText(parsed.source);

      const project = await prisma.project.findUnique({
        where: { id: projectGuard.id },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const publicForm = await prisma.publicForm.findFirst({
        where: {
          projectId: project.id,
          formKey,
          isActive: true,
        },
      });

      
      if (!publicForm) {
        return res.status(410).json({ error: 'Form is disabled' });
      }

      // Idempotency: if the same request was already processed, return the existing case/transaction
      if (normalizedClientRequestId) {
        const existingCase = await prisma.case.findFirst({
          where: {
            projectId: project.id,
            clientRequestId: normalizedClientRequestId,
          },
          include: { contact: true },
        });

        if (existingCase) {
          const existingTx = await prisma.transaction.findFirst({
            where: {
              projectId: project.id,
              caseId: existingCase.id,
              publicFormId: publicForm.id,
            },
            orderBy: { id: 'desc' },
          });

          return res.status(200).json({
            contact: existingCase.contact,
            case: existingCase,
            transaction: existingTx,
          });
        }
      }

      let contact: any = null;

      if (email) {
        contact = await prisma.contact.findFirst({
          where: {
            projectId: project.id,
            email,
          },
        });
      }

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            projectId: project.id,
            name: computeContactName(name, email, phone),
            email: email || null,
            phone: phone || null,
            notes: message || null,
          },
        });
      }

      const donationDetailsParts: string[] = [];
      donationDetailsParts.push(`Сума: ${amount} UAH`);
      if (message) donationDetailsParts.push(`Коментар: ${message}`);
      const donationDescription = donationDetailsParts.join(' | ');

      const txCategories = getTransactionCategoriesConfig(project);
      const donationCategory =
        (Array.isArray(txCategories)
          ? txCategories.find((cat) => cat.code === 'donation' && cat.type === 'income') ||
            txCategories.find((cat) => cat.type === 'income')
          : null);

      let donationCase: any = null;
      let transaction: any = null;

      try {
        const created = await prisma.$transaction(async (tx) => {
          const c = await tx.case.create({
            data: {
              projectId: project.id,
              contactId: contact.id,
              publicFormId: publicForm ? publicForm.id : null,
              clientRequestId: normalizedClientRequestId || null,
              title: 'Нове пожертвування з сайту',
              description: donationDescription || null,
              status: 'new',
              source: source || 'donation-widget',
            },
          });

          const t = await tx.transaction.create({
            data: {
              projectId: project.id,
              contactId: contact.id,
              caseId: c.id,
              publicFormId: publicForm ? publicForm.id : null,
              type: 'income',
              amount,
              currency: 'UAH',
              category: donationCategory ? donationCategory.code : 'donation',
              description: message || null,
            },
          });

          return { c, t };
        });

        donationCase = created.c;
        transaction = created.t;
      } catch (err: any) {
        if (normalizedClientRequestId && isPrismaUniqueConstraintError(err)) {
          const existingCase = await prisma.case.findFirst({
            where: {
              projectId: project.id,
              clientRequestId: normalizedClientRequestId,
            },
            include: { contact: true },
          });

          if (existingCase) {
            const existingTx = await prisma.transaction.findFirst({
              where: {
                projectId: project.id,
                caseId: existingCase.id,
                publicFormId: publicForm ? publicForm.id : null,
              },
              orderBy: { id: 'desc' },
            });

            return res.status(200).json({
              contact: existingCase.contact,
              case: existingCase,
              transaction: existingTx,
              idempotent: true,
            });
          }
        }

        console.error('Error creating donation case/transaction', err);
        return res.status(500).json({ error: 'Failed to process donation' });
      }

      const notifCfg = getNotificationConfig(project);
      if (!isSmokeRequest && notifCfg.notifyOnDonation && notifCfg.emails.length) {
        const subject = `Нове пожертвування — ${project.name}`;
        const lines: string[] = [];
        if (name) lines.push(`Ім'я: ${name}`);
        if (email) lines.push(`Email: ${email}`);
        if (phone) lines.push(`Телефон: ${phone}`);
        lines.push(`Сума: ${amount} UAH`);
        if (message) lines.push(`Коментар: ${message}`);
        if (source) lines.push(`Джерело: ${source}`);
        if (donationCase && donationCase.id) {
          lines.push(`Case ID: ${donationCase.id}`);
        }
        const text = lines.join('\n');
        await sendNotificationMail({
          kind: 'donation',
          projectName: project.name,
          projectSlug: project.slug,
          to: notifCfg.emails,
          subject,
          text,
        });
      }

      return res.status(201).json({
        contact,
        case: donationCase,
        transaction,
      });
    }

    // ----- BOOKING -----
    if (formKey === 'booking') {
      const parsed = publicBookingSchema.parse(req.body);

      if (parsed.__hp && parsed.__hp.trim().length > 0) {
        console.warn('Honeypot (booking) triggered for project', projectSlug);
        return res.status(202).json({ received: true });
      }

      const name = normalizeText(parsed.name);
      const email = normalizeText(parsed.email);
      const phone = normalizePhone(parsed.phone);
      const service = normalizeText(parsed.service);
      const date = normalizeText(parsed.date);
      const time = normalizeText(parsed.time);
      const message = normalizeText(parsed.message);
      const source = normalizeText(parsed.source);

      const project = await prisma.project.findUnique({
        where: { id: projectGuard.id },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const publicForm = await prisma.publicForm.findFirst({
        where: {
          projectId: project.id,
          formKey,
          isActive: true,
        },
      });

      
      if (!publicForm) {
        return res.status(410).json({ error: 'Form is disabled' });
      }

      if (normalizedClientRequestId) {
        const existing = await prisma.case.findFirst({
          where: {
            projectId: project.id,
            clientRequestId: normalizedClientRequestId,
          },
          include: { contact: true },
        });

        if (existing) {
          return res.status(200).json({
            contact: existing.contact,
            case: existing,
          });
        }
      }
      let contact: any = null;

      if (email) {
        contact = await prisma.contact.findFirst({
          where: {
            projectId: project.id,
            email,
          },
        });
      }

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            projectId: project.id,
            name: computeContactName(name, email, phone),
            email: email || null,
            phone: phone || null,
            notes: message || null,
          },
        });
      }

      const detailsParts: string[] = [];
      if (service) detailsParts.push(`Послуга: ${service}`);
      if (date || time) {
        const dt = [date, time].filter(Boolean).join(' ');
        detailsParts.push(`Коли: ${dt}`);
      }
      if (message) detailsParts.push(`Коментар: ${message}`);
      const details = detailsParts.join(' | ');

      let bookingCase: any = null;
      try {
        bookingCase = await prisma.case.create({
          data: {
            projectId: project.id,
            contactId: contact.id,
            publicFormId: publicForm ? publicForm.id : null,
            clientRequestId: normalizedClientRequestId || null,
            title: 'Нове бронювання з сайту',
            status: 'new',
            source: source || 'booking-widget',
            description: details || null,
          },
        });
      } catch (caseError: any) {
        if (normalizedClientRequestId && isPrismaUniqueConstraintError(caseError)) {
          const existing = await prisma.case.findFirst({
            where: { projectId: project.id, clientRequestId: normalizedClientRequestId },
            include: { contact: true },
          });

          if (existing) {
            return res.status(200).json({
              contact: existing.contact,
              case: existing,
              idempotent: true,
            });
          }
        }
        console.error('Error creating case for booking', caseError);
        return res.status(500).json({ error: 'Failed to create case' });
      }

      const notifCfg = getNotificationConfig(project);
      if (!isSmokeRequest && notifCfg.notifyOnBooking && notifCfg.emails.length) {
        const subject = `Нове бронювання — ${project.name}`;
        const lines: string[] = [];
        if (name) lines.push(`Ім'я: ${name}`);
        if (email) lines.push(`Email: ${email}`);
        if (phone) lines.push(`Телефон: ${phone}`);
        if (service) lines.push(`Послуга: ${service}`);
        if (date || time) {
          const dt = [date, time].filter(Boolean).join(' ');
          lines.push(`Коли: ${dt}`);
        }
        if (message) lines.push(`Коментар: ${message}`);
        if (source) lines.push(`Джерело: ${source}`);
        if (bookingCase && bookingCase.id) {
          lines.push(`Case ID: ${bookingCase.id}`);
        }
        const text = lines.join('\n');
        await sendNotificationMail({
          kind: 'booking',
          projectName: project.name,
          projectSlug: project.slug,
          to: notifCfg.emails,
          subject,
          text,
        });
      }

      return res.status(201).json({
        contact,
        case: bookingCase,
      });
    }

    // ----- FEEDBACK -----
    if (formKey === 'feedback') {
      const parsed = publicFeedbackSchema.parse(req.body);

      if (parsed.__hp && parsed.__hp.trim().length > 0) {
        console.warn('Honeypot (feedback) triggered for project', projectSlug);
        return res.status(202).json({ received: true });
      }

      const name = normalizeText(parsed.name);
      const email = normalizeText(parsed.email);
      const phone = normalizePhone(parsed.phone);
      const message = normalizeText(parsed.message);
      const source = normalizeText(parsed.source);
      const rating = typeof parsed.rating === 'number' ? parsed.rating : undefined;

      const project = await prisma.project.findUnique({
        where: { id: projectGuard.id },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const publicForm = await prisma.publicForm.findFirst({
        where: {
          projectId: project.id,
          formKey,
          isActive: true,
        },
      });

      
      if (!publicForm) {
        return res.status(410).json({ error: 'Form is disabled' });
      }
let contact: any = null;

      if (email) {
        contact = await prisma.contact.findFirst({
          where: {
            projectId: project.id,
            email,
          },
        });
      }

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            projectId: project.id,
            name: computeContactName(name, email, phone),
            email: email || null,
            phone: phone || null,
            notes: null,
          },
        });
      }

      const detailParts: string[] = [];
      if (typeof rating === 'number' && !Number.isNaN(rating)) {
        detailParts.push(`Оцінка: ${rating}/5`);
      }
      if (message) {
        detailParts.push(`Відгук: ${message}`);
      }
      const description = detailParts.join(' | ');

      let feedbackCase: any = null;
      try {
        feedbackCase = await prisma.case.create({
          data: {
            projectId: project.id,
            contactId: contact.id,
            publicFormId: publicForm ? publicForm.id : null,
            clientRequestId: normalizedClientRequestId || null,
            title: 'Новий відгук з сайту',
            status: 'new',
            source: source || 'feedback-widget',
            description: description || null,
          },
        });
      } catch (caseError: any) {
        if (normalizedClientRequestId && isPrismaUniqueConstraintError(caseError)) {
          const existing = await prisma.case.findFirst({
            where: { projectId: project.id, clientRequestId: normalizedClientRequestId },
            include: { contact: true },
          });

          if (existing) {
            return res.status(200).json({
              contact: existing.contact,
              case: existing,
              idempotent: true,
            });
          }
        }
        console.error('Error creating case for feedback', caseError);
        return res.status(500).json({ error: 'Failed to create case' });
      }

      const notifCfg = getNotificationConfig(project);
      if (!isSmokeRequest && notifCfg.notifyOnFeedback && notifCfg.emails.length) {
        const subject = `Новий відгук — ${project.name}`;
        const lines: string[] = [];
        if (name) lines.push(`Ім'я: ${name}`);
        if (email) lines.push(`Email: ${email}`);
        if (phone) lines.push(`Телефон: ${phone}`);
        if (typeof rating === 'number' && !Number.isNaN(rating)) {
          lines.push(`Оцінка: ${rating}/5`);
        }
        if (message) lines.push(`Відгук: ${message}`);
        if (source) lines.push(`Джерело: ${source}`);
        if (feedbackCase && feedbackCase.id) {
          lines.push(`Case ID: ${feedbackCase.id}`);
        }
        const text = lines.join('\n');
        await sendNotificationMail({
          kind: 'feedback',
          projectName: project.name,
          projectSlug: project.slug,
          to: notifCfg.emails,
          subject,
          text,
        });
      }

      return res.status(201).json({
        contact,
        case: feedbackCase,
      });
    }

    return res.status(404).json({ error: 'Unknown public form' });
  } catch (error: any) {
    if (error instanceof ZodError) {
      // Validation errors are expected in normal operation (and in smoke validation tests).
      // Keep logs clean: no stacktrace.
      if (process.env.LOG_PUBLIC_VALIDATION === '1') {
        console.warn('Public form validation error:', error.errors);
      }
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    console.error('Error handling public form', error);
    return res.status(500).json({ error: 'Failed to submit public form' });
  }
});

export default router;
