import express from 'express';
import { z, ZodError } from 'zod';
import prisma from '../db/client';

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

      const transaction = await prisma.transaction.create({
        data: {
          projectId: project.id,
          contactId: contact.id,
          caseId: donationCase ? donationCase.id : null,
          type: 'income',
          amount,
          currency: 'UAH',
          category: 'donation',
          description: message || null,
        },
      });

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
