import express from 'express';
import { z, ZodError } from 'zod';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import prisma from '../db/client';
import { sendNotificationMail } from '../services/mailer';
import { findOrCreateContact } from '../services/contacts';
import { sanitizeText } from '../utils/sanitizeText';

const router = express.Router();


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

function getJwtSecret(): string {
  // Must match src/middleware/auth.ts
  // NOTE: The admin UI uses the same JWT secret fallback.
  return String(process.env.JWT_SECRET || 'dev-mini-crm-secret');
}

async function isAuthedMemberForProject(req: any, projectId: number): Promise<boolean> {
  // Preview/Demo page is served from /admin and has access to the admin token in localStorage.
  // We allow bypassing Origin/Referer allowlist ONLY when a valid admin JWT is presented.
  const auth = getHeader(req, 'Authorization');
  if (!auth) return false;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const token = String(m[1] || '').trim();
  if (!token) return false;

  try {
    const payload: any = jwt.verify(token, getJwtSecret());
    const userId = Number(payload && payload.userId);
    const tokenProjectId = Number(payload && payload.projectId);
    if (!userId || !tokenProjectId) return false;
    if (Number(projectId) !== tokenProjectId) return false;

    const membership = await prisma.membership.findFirst({
      where: { userId, projectId },
      select: { id: true },
    });
    return !!membership;
  } catch {
    return false;
  }
}

// NOTE: raw contact normalization is handled by contacts.service (emailNormalized/phoneNormalized).
// Here we only sanitize user-provided strings for safe storage/output.


// ---------- Public form schema (P2.1 PR1) ----------

type PublicFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'textarea'
  | 'number'
  | 'amount'
  | 'select'
  | 'checkbox';

type PublicFormField = {
  name: string;
  type: PublicFieldType;
  label?: string;
  required?: boolean;
  placeholder?: string;
  min?: number; // string length OR numeric min (depends on type)
  max?: number; // string length OR numeric max (depends on type)
  pattern?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: any;
};

type PublicFormSchema = {
  configVersion: string;
  fields: PublicFormField[];
  rules?: Record<string, any>;
};

function buildDefaultSchemaForForm(formKey: string): PublicFormSchema {
  // NOTE: Source of truth is PublicForm.config.
  // These defaults are used ONLY when config is missing (legacy DB rows),
  // to avoid breaking existing widget installations.

  if (formKey === 'donation') {
    return {
      configVersion: 'legacy-1',
      fields: [
        { name: 'name', type: 'text', label: "Ім'я", max: 100 },
        { name: 'email', type: 'email', label: 'Email', max: 255 },
        { name: 'phone', type: 'tel', label: 'Телефон', max: 30 },
        { name: 'amount', type: 'amount', label: 'Сума', required: true, min: 0.01, max: 1_000_000 },
        { name: 'message', type: 'textarea', label: 'Коментар', max: 2000 },
        { name: 'source', type: 'text', label: 'Джерело', max: 100 },
      ],
      rules: { requireOneOf: ['name', 'email', 'phone'] },
    };
  }

  if (formKey === 'booking') {
    return {
      configVersion: 'legacy-1',
      fields: [
        { name: 'name', type: 'text', label: "Ім'я", max: 100 },
        { name: 'email', type: 'email', label: 'Email', max: 255 },
        { name: 'phone', type: 'tel', label: 'Телефон', max: 30 },
        { name: 'service', type: 'text', label: 'Послуга', max: 120 },
        { name: 'date', type: 'text', label: 'Дата', max: 50 },
        { name: 'time', type: 'text', label: 'Час', max: 50 },
        { name: 'message', type: 'textarea', label: 'Коментар', max: 2000 },
        { name: 'source', type: 'text', label: 'Джерело', max: 100 },
      ],
      rules: { requireOneOf: ['name', 'email', 'phone'] },
    };
  }

  if (formKey === 'feedback') {
    return {
      configVersion: 'legacy-1',
      fields: [
        { name: 'name', type: 'text', label: "Ім'я", max: 100 },
        { name: 'email', type: 'email', label: 'Email', max: 255 },
        { name: 'phone', type: 'tel', label: 'Телефон', max: 30 },
        { name: 'message', type: 'textarea', label: 'Відгук', required: true, max: 2000 },
        { name: 'rating', type: 'number', label: 'Оцінка', min: 1, max: 5 },
        { name: 'clientRequestId', type: 'text', label: 'Client Request ID', max: 80 },
        { name: 'source', type: 'text', label: 'Джерело', max: 100 },
      ],
      rules: { requireOneOf: ['name', 'email', 'phone'] },
    };
  }

  // lead (default)
  return {
    configVersion: 'legacy-1',
    fields: [
      { name: 'name', type: 'text', label: "Ім'я", max: 100 },
      { name: 'email', type: 'email', label: 'Email', max: 255 },
      { name: 'phone', type: 'tel', label: 'Телефон', max: 30 },
      { name: 'message', type: 'textarea', label: 'Повідомлення', max: 2000 },
      { name: 'source', type: 'text', label: 'Джерело', max: 100 },
    ],
    rules: { requireOneOf: ['name', 'email', 'phone'] },
  };
}

function validatePublicPayloadBySchema(schema: PublicFormSchema, body: any) {
  const errors: Array<{ field: string; message: string }> = [];
  const out: Record<string, any> = {};

  const getVal = (name: string) =>
    body && Object.prototype.hasOwnProperty.call(body, name) ? (body as any)[name] : undefined;

  for (const f of schema.fields) {
    const raw = getVal(f.name);

    const isEmpty =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim() === '') ||
      (typeof raw === 'number' && Number.isNaN(raw));

    if (f.required && isEmpty) {
      errors.push({ field: f.name, message: 'Required' });
      continue;
    }

    if (isEmpty) continue;

    if (f.type === 'checkbox') {
      const v = raw === true || raw === 'true' || raw === '1' || raw === 1;
      out[f.name] = v;
      continue;
    }

    if (f.type === 'number' || f.type === 'amount') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n)) {
        errors.push({ field: f.name, message: 'Must be a number' });
        continue;
      }
      if (typeof f.min === 'number' && n < f.min) {
        errors.push({ field: f.name, message: `Must be >= ${f.min}` });
        continue;
      }
      if (typeof f.max === 'number' && n > f.max) {
        errors.push({ field: f.name, message: `Must be <= ${f.max}` });
        continue;
      }
      out[f.name] = n;
      continue;
    }

    const s = String(raw).trim();
    if (typeof f.min === 'number' && s.length < f.min) {
      errors.push({ field: f.name, message: `Min length ${f.min}` });
      continue;
    }
    if (typeof f.max === 'number' && s.length > f.max) {
      errors.push({ field: f.name, message: `Max length ${f.max}` });
      continue;
    }
    if (f.pattern) {
      try {
        const r = new RegExp(f.pattern);
        if (!r.test(s)) {
          errors.push({ field: f.name, message: 'Invalid format' });
          continue;
        }
      } catch {
        // ignore invalid server pattern
      }
    }
    if (f.type === 'email') {
      const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailLike.test(s)) {
        errors.push({ field: f.name, message: 'Invalid email' });
        continue;
      }
    }

    out[f.name] = s;
  }

  const requireOneOf =
    schema.rules && Array.isArray((schema.rules as any).requireOneOf)
      ? (schema.rules as any).requireOneOf
      : null;
  if (requireOneOf && requireOneOf.length > 0) {
    const ok = requireOneOf.some((k: string) => {
      const v = out[k];
      return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
    });
    if (!ok) {
      errors.push({
        field: requireOneOf[0] || 'name',
        message: `At least one of ${requireOneOf.join(', ')} is required`,
      });
    }
  }

  return { ok: errors.length === 0, errors, data: out };
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
    // Admin Preview bypass: if the request carries a valid admin JWT for this project,
    // we allow it even when the project has a strict Origin/Referer allowlist.
    // This enables /admin/preview.html to work on localhost and production without
    // forcing localhost into the project allowlist.
    const authedBypass = await isAuthedMemberForProject(req, project.id);
    if (authedBypass) {
      return project;
    }

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
    clientRequestId: z.string().trim().max(80).optional(),
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
      select: { formKey: true, title: true, isActive: true, config: true },
    });

    if (!publicForm) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const cfg: any = publicForm.config || null;
    const schema: any = cfg && typeof cfg === 'object' && Array.isArray((cfg as any).fields)
      ? {
          configVersion: String((cfg as any).configVersion || '1'),
          fields: (cfg as any).fields,
          rules: (cfg as any).rules || {},
        }
      : buildDefaultSchemaForForm(publicForm.formKey);

    return res.json({
      formKey: publicForm.formKey,
      title: publicForm.title,
      isActive: publicForm.isActive,
      configVersion: schema.configVersion,
      fields: schema.fields,
      rules: schema.rules || {},
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



// ---- Load public form + schema (P2.1 PR1) ----
const publicFormRow = await prisma.publicForm.findFirst({
  where: { projectId: projectGuard.id, formKey },
  select: { id: true, formKey: true, title: true, isActive: true, config: true },
});

if (!publicFormRow) {
  return res.status(404).json({ error: 'Form not found' });
}

if (!publicFormRow.isActive) {
  return res.status(410).json({ error: 'Form is disabled' });
}

const cfg: any = publicFormRow.config || null;
const schema: any = cfg && typeof cfg === 'object' && Array.isArray((cfg as any).fields)
  ? {
      configVersion: String((cfg as any).configVersion || '1'),
      fields: (cfg as any).fields,
      rules: (cfg as any).rules || {},
    }
  : buildDefaultSchemaForForm(publicFormRow.formKey);

const validated = validatePublicPayloadBySchema(schema, req.body);
if (!validated.ok) {
  return res.status(400).json({
    error: 'Invalid form payload',
    details: validated.errors,
  });
}

// Merge sanitized/coerced values back (keeps __hp/clientRequestId if present)
req.body = { ...(req.body || {}), ...(validated.data || {}) };
    // ----- LEAD -----
    if (formKey === 'lead') {
      const parsed = publicLeadSchema.parse(req.body);

      if (parsed.__hp && parsed.__hp.trim().length > 0) {
        console.warn('Honeypot triggered for project', projectSlug);
        return res.status(202).json({ received: true });
      }

      const name = sanitizeText(parsed.name, 100);
      const email = sanitizeText(parsed.email, 255);
      const phone = sanitizeText(parsed.phone, 30);
      const message = sanitizeText(parsed.message, 2000);
      const source = sanitizeText(parsed.source, 100);

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

      let leadCase: any = null;
      let contact: any = null;

      try {
        const result = await prisma.$transaction(async (tx) => {
          const createdOrExistingContact = await findOrCreateContact(
            project.id,
            { name, email, phone, notes: message || null },
            tx
          );

          const createdCase = await tx.case.create({
            data: {
              projectId: project.id,
              contactId: createdOrExistingContact.id,
              publicFormId: publicForm ? publicForm.id : null,
              clientRequestId: normalizedClientRequestId || null,
              title: 'Новий лід з сайту',
              description: message || null,
              status: 'new',
              source: source || 'widget',
            },
          });

          return { createdOrExistingContact, createdCase };
        });

        contact = result.createdOrExistingContact;
        leadCase = result.createdCase;
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

      return res.status(201).json({ contact, case: leadCase });
    }

    // ----- DONATION -----
    if (formKey === 'donation') {
      const parsed = publicDonationSchema.parse(req.body);

      if (parsed.__hp && parsed.__hp.trim().length > 0) {
        console.warn('Honeypot (donation) triggered for project', projectSlug);
        return res.status(202).json({ received: true });
      }

      const name = sanitizeText(parsed.name, 100);
      const email = sanitizeText(parsed.email, 255);
      const phone = sanitizeText(parsed.phone, 30);
      const amount = parsed.amount;
      const message = sanitizeText(parsed.message, 2000);
      const source = sanitizeText(parsed.source, 100);

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

      const contactName =
        name || (email ? email.split('@')[0] : undefined) || phone || 'Anonymous';

      // IMPORTANT: create/reuse Contact inside the same transaction as Case/Transaction
      // to avoid "orphan" contacts when Case creation fails.

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

    let contact: any = null;

      try {
        const created = await prisma.$transaction(async (tx) => {
          const contact = await findOrCreateContact(
            project.id,
            { name: contactName, email, phone, notes: message || null },
            tx
          );

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

          return { contact, c, t };
        });

        donationCase = created.c;
        transaction = created.t;
        // ensure response includes the used/created contact
        // (kept in sync with other public submit handlers)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        contact = created.contact;
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

      const name = sanitizeText(parsed.name, 100);
      const email = sanitizeText(parsed.email, 255);
      const phone = sanitizeText(parsed.phone, 30);
      const service = sanitizeText(parsed.service, 120);
      const date = sanitizeText(parsed.date, 50);
      const time = sanitizeText(parsed.time, 50);
      const message = sanitizeText(parsed.message, 2000);
      const source = sanitizeText(parsed.source, 100);

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
      const detailsParts: string[] = [];
      if (service) detailsParts.push(`Послуга: ${service}`);
      if (date || time) {
        const dt = [date, time].filter(Boolean).join(' ');
        detailsParts.push(`Коли: ${dt}`);
      }
      if (message) detailsParts.push(`Коментар: ${message}`);
      const details = detailsParts.join(' | ');

      const contactName = name || email || phone || 'Guest';

      let bookingCase: any = null;
      let contact: any = null;
      try {
        const created = await prisma.$transaction(async (tx) => {
          const contact = await findOrCreateContact(
            project.id,
            { name: contactName, email, phone, notes: message || null },
            tx
          );

          const createdCase = await tx.case.create({
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

          return { contact, createdCase };
        });

        contact = created.contact;
        bookingCase = created.createdCase;
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

    // -
    if (formKey === 'feedback') {
      const parsed = publicFeedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation error', details: parsed.error.errors });
      }

      const { name, email, phone, message, rating } = parsed.data;

      const nameS = sanitizeText(name, 100);
      const emailS = sanitizeText(email, 255);
      const phoneS = sanitizeText(phone, 30);
      const messageS = sanitizeText(message, 2000);

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

      // Idempotency (optional): if we already processed this clientRequestId, return the same response.
      if (normalizedClientRequestId) {
        const existing = await prisma.case.findFirst({
          where: {
            projectId: project.id,
            clientRequestId: normalizedClientRequestId,
          },
          include: { contact: true },
        });

        if (existing) {
          return res.status(200).json({ contact: existing.contact, case: existing });
        }
      }

      const safeName =
        nameS || (emailS ? emailS.split('@')[0] : undefined) || phoneS || 'Anonymous';
      const { contact, feedbackCase } = await prisma.$transaction(async (tx) => {
        const contact = await findOrCreateContact(
          project.id,
          { name: safeName, email: emailS, phone: phoneS, notes: null },
          tx
        );

        const parts: string[] = [];
        if (typeof rating === 'number') parts.push(`Rating: ${rating}/5`);
        if (messageS) parts.push(messageS);

        const feedbackCase = await tx.case.create({
          data: {
            projectId: project.id,
            publicFormId: publicForm.id,
            contactId: contact.id,
            title: 'Public feedback',
            status: 'new',
            source: 'public:feedback',
            description: parts.join('\n\n') || null,
            clientRequestId: normalizedClientRequestId || null,
          },
        });

        return { contact, feedbackCase };
      });

      const notifCfg = getNotificationConfig(project);
      if (!isSmokeRequest && notifCfg.notifyOnFeedback && notifCfg.emails.length) {
        const subject = `[${project.name}] Feedback: ${publicForm.title}`;
        const lines: string[] = [];
        lines.push(`Project: ${project.name} (${project.slug})`);
        lines.push(`Form: ${publicForm.title} (${publicForm.formKey})`);
        if (contact?.name) lines.push(`Name: ${contact.name}`);
        if (contact?.email) lines.push(`Email: ${contact.email}`);
        if (contact?.phone) lines.push(`Phone: ${contact.phone}`);
        if (typeof rating === 'number') lines.push(`Rating: ${rating}/5`);
        if (message) {
          lines.push('');
          lines.push('Message:');
          lines.push(message);
        }
        lines.push('');
        lines.push(`Case ID: ${feedbackCase.id}`);

        await sendNotificationMail({
          to: notifCfg.emails,
          kind: 'feedback',
          projectName: project.name,
          projectSlug: project.slug,
          subject,
            text: lines.join('\n'),
        });
      }

      return res.status(201).json({ contact, case: feedbackCase });
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
