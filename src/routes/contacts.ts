import express from 'express';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types/auth';

const router = express.Router();

const createContactSchema = z
  .object({
    name: z.string().max(255).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(50).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (data) => data.name || data.email || data.phone,
    {
      message: 'At least one of name, email or phone is required',
      path: ['name'],
    }
  );

const updateContactSchema = z
  .object({
    name: z.string().max(255).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(50).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (data) => data.name || data.email || data.phone || data.notes,
    {
      message: 'At least one field must be provided',
      path: ['name'],
    }
  );

// GET /contacts - list contacts for current project
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;

    const contacts = await prisma.contact.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(contacts);
  } catch (error) {
    console.error('Error fetching contacts', error);
    return res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST /contacts - create a contact
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const { name, email, phone, notes } = createContactSchema.parse(req.body);

    const safeName = (name && name.trim()) || (email && email.trim()) || (phone && phone.trim()) || 'Unknown';

    const contact = await prisma.contact.create({
      data: {
        projectId,
        name: safeName,
        email: email || null,
        phone: phone || null,
        notes: notes || null,
      },
    });

    return res.status(201).json(contact);
  } catch (error: any) {
    console.error('Error creating contact', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to create contact' });
  }
});

// PATCH /contacts/:id - update a contact
router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid contact id' });
    }

    const data = updateContactSchema.parse(req.body);

    const contact = await prisma.contact.update({
      where: {
        id_projectId: {
          id,
          projectId,
        },
      },
      data,
    });

    return res.json(contact);
  } catch (error: any) {
    console.error('Error updating contact', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Contact not found' });
    }

    return res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE /contacts/:id - delete a contact
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid contact id' });
    }

    await prisma.contact.delete({
      where: {
        id_projectId: {
          id,
          projectId,
        },
      },
    });

    return res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting contact', error);

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Contact not found' });
    }

    return res.status(500).json({ error: 'Failed to delete contact' });
  }
});

export default router;
