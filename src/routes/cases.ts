import express from 'express';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types/auth';

const router = express.Router();

const createCaseSchema = z.object({
  title: z.string().min(1, 'title is required').max(255),
  description: z.string().max(2000).optional(),
  internalNote: z.string().max(4000).optional(),
  status: z.string().max(100).optional(),
  source: z.string().max(100).optional(),
  contactId: z.number().int().positive().optional(),
});

const updateCaseSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    internalNote: z.string().max(4000).optional(),
    status: z.string().max(100).optional(),
    source: z.string().max(100).optional(),
    contactId: z.number().int().positive().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.internalNote !== undefined ||
      data.status !== undefined ||
      data.source !== undefined ||
      data.contactId !== undefined,
    {
      message: 'At least one field must be provided',
      path: ['title'],
    }
  );

const listCasesQuerySchema = z.object({
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

// GET /cases - list cases for current project with optional filters
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const { status, dateFrom, dateTo } = listCasesQuerySchema.parse(req.query);

    const where: any = { projectId };

    if (status) {
      // support simple comma-separated list: status=new,in_progress
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => s !== 'all');
      if (statuses.length === 0) {
        // 'all' (or empty) means no status filter
      } else if (statuses.length === 1) {
        where.status = statuses[0];
      } else {
        where.status = { in: statuses };
      }
    }

    if (dateFrom || dateTo) {
      const createdAt: any = {};
      if (dateFrom) {
        const dFrom = new Date(dateFrom);
        if (Number.isNaN(dFrom.getTime())) {
          return res.status(400).json({ error: 'Invalid dateFrom' });
        }
        createdAt.gte = dFrom;
      }
      if (dateTo) {
        const dTo = new Date(dateTo);
        if (Number.isNaN(dTo.getTime())) {
          return res.status(400).json({ error: 'Invalid dateTo' });
        }
        createdAt.lte = dTo;
      }
      where.createdAt = createdAt;
    }

    const cases = await prisma.case.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        contact: true,
      },
    });

    return res.json(cases);
  } catch (error: any) {
    console.error('Error fetching cases', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to fetch cases' });
  }
});

// POST /cases - create a case for current project
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const parsed = createCaseSchema.parse(req.body);

    let contactId: number | undefined = parsed.contactId;

    if (contactId !== undefined) {
      const contact = await prisma.contact.findUnique({
        where: {
          id_projectId: {
            id: contactId,
            projectId,
          },
        },
      });

      if (!contact) {
        return res.status(404).json({ error: 'Contact not found for this project' });
      }
    }

    const created = await prisma.case.create({
      data: {
        projectId,
        contactId: contactId ?? null,
        title: parsed.title,
        description: parsed.description ?? null,
        internalNote: parsed.internalNote ?? null,
        status: parsed.status || 'new',
        source: parsed.source || null,
      },
      include: {
        contact: true,
      },
    });

    return res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating case', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to create case' });
  }
});

// PATCH /cases/:id - update a case
router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    const data = updateCaseSchema.parse(req.body);

    let contactId: number | undefined = data.contactId;

    if (contactId !== undefined) {
      const contact = await prisma.contact.findUnique({
        where: {
          id_projectId: {
            id: contactId,
            projectId,
          },
        },
      });

      if (!contact) {
        return res.status(404).json({ error: 'Contact not found for this project' });
      }
    }

    const updated = await prisma.case.update({
      where: {
        id_projectId: {
          id,
          projectId,
        },
      },
      data: {
        title: data.title,
        description: data.description,
        internalNote: data.internalNote,
        status: data.status,
        source: data.source,
        contactId: contactId ?? undefined,
      },
      include: {
        contact: true,
      },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error('Error updating case', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'Case not found' });
    }

    const message = typeof error?.message === 'string' && error.message.trim().length > 0
      ? error.message
      : 'Failed to update case';

    return res.status(500).json({ error: message });
  }
});

// DELETE /cases/:id - delete a case
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    await prisma.case.delete({
      where: {
        id_projectId: {
          id,
          projectId,
        },
      },
    });

    return res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting case', error);

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Case not found' });
    }

    return res.status(500).json({ error: 'Failed to delete case' });
  }
});

export default router;
