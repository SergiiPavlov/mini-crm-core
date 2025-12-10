import express from 'express';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { sendNotificationMail } from '../services/mailer';

const router = express.Router();

// Basic lead form (general contact/lead)
const publicLeadSchema = z
  .object({
    name: z.string().max(255).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(50).optional(),
    message: z.string().max(2000).optional(),
    source: z.string().max(100).optional(),
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
    name: z.string().max(255).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(50).optional(),
    amount: z.coerce.number().positive('amount must be greater than 0'),
    message: z.string().max(2000).optional(),
    source: z.string().max(100).optional(),
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
    name: z.string().max(255).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(50).optional(),
    service: z.string().max(255).optional(),
    date: z.string().max(50).optional(),
    time: z.string().max(50).optional(),
    message: z.string().max(2000).optional(),
    source: z.string().max(100).optional(),
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
    name: z.string().max(255).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(50).optional(),
    message: z.string().max(4000),
    rating: z.coerce.number().min(1).max(5).optional(),
    source: z.string().max(100).optional(),
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
    const code =
      typeof cat.code === 'string' && cat.code.trim() ? cat.code.trim() : `category_${index + 1}`;
    const label =
      typeof cat.label === 'string' && cat.label.trim() ? cat.label.trim() : code;
    const color =
      typeof cat.color === 'string' && cat.color.trim()
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
// Unified handler for public forms
router.post('/forms/:projectSlug/:formKey', async (req, res) => {
  try {
    const { projectSlug, formKey } = req.params;

    // ----- LEAD -----
    if (formKey === 'lead') {
      const parsed = publicLeadSchema.parse(req.body);

      if (parsed.__hp && parsed.__hp.trim().length > 0) {
        console.warn('Honeypot triggered for project', projectSlug);
        return res.status(202).json({ received: true });
      }

      const { name, email, phone, message, source } = parsed;

      const project = await prisma.project.findUnique({
        where: { slug: projectSlug },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const contact = await prisma.contact.create({
        data: {
          projectId: project.id,
          name: name || null,
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
            title: 'Новий лід з сайту',
            description: message || null,
            status: 'new',
            source: source || 'widget',
          },
        });
      } catch (caseError) {
        console.error('Error creating case for lead', caseError);
      }

      const notifCfg = getNotificationConfig(project);
      if (notifCfg.notifyOnLead && notifCfg.emails.length) {
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

      const { name, email, phone, amount, message, source } = parsed;

      const project = await prisma.project.findUnique({
        where: { slug: projectSlug },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
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
            name: name || null,
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

      let donationCase: any = null;
      try {
        donationCase = await prisma.case.create({
          data: {
            projectId: project.id,
            contactId: contact.id,
            title: 'Нове пожертвування з сайту',
            description: donationDescription || null,
            status: 'new',
            source: source || 'donation-widget',
          },
        });
      } catch (caseError) {
        console.error('Error creating case for donation', caseError);
      }

      const donationCategory =
        pickProjectTransactionCategory(project, ['donation'], 'income') ||
        pickProjectTransactionCategory(project, [], 'income');

      const transaction = await prisma.transaction.create({
        data: {
          projectId: project.id,
          contactId: contact.id,
          caseId: donationCase ? donationCase.id : null,
          type: 'income',
          amount,
          currency: 'UAH',
          category: donationCategory ? donationCategory.code : 'donation',
          description: message || null,
        },
      });

      const notifCfg = getNotificationConfig(project);
      if (notifCfg.notifyOnDonation && notifCfg.emails.length) {
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

      const { name, email, phone, service, date, time, message, source } = parsed;

      const project = await prisma.project.findUnique({
        where: { slug: projectSlug },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
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
            name: name || null,
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

      const bookingCase = await prisma.case.create({
        data: {
          projectId: project.id,
          contactId: contact.id,
          title: 'Нове бронювання з сайту',
          status: 'new',
          source: source || 'booking-widget',
          description: details || null,
        },
      });

      const notifCfg = getNotificationConfig(project);
      if (notifCfg.notifyOnBooking && notifCfg.emails.length) {
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

      const { name, email, phone, message, rating, source } = parsed;

      const project = await prisma.project.findUnique({
        where: { slug: projectSlug },
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
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
            name: name || null,
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

      const feedbackCase = await prisma.case.create({
        data: {
          projectId: project.id,
          contactId: contact.id,
          title: 'Новий відгук з сайту',
          status: 'new',
          source: source || 'feedback-widget',
          description: description || null,
        },
      });

      const notifCfg = getNotificationConfig(project);
      if (notifCfg.notifyOnFeedback && notifCfg.emails.length) {
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
    console.error('Error handling public form', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to submit public form' });
  }
});

export default router;
