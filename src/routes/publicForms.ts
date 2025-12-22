import express from 'express';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types/auth';

const router = express.Router();

/**
 * GET /public-forms
 * Returns all public forms for the current project of the authenticated user.
 */
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const forms = await prisma.publicForm.findMany({
      where: { projectId: user.projectId },
      orderBy: [{ formKey: 'asc' }, { id: 'asc' }],
    });

    return res.json(forms);
  } catch (error: any) {
    console.error('Error loading public forms', error);
    return res.status(500).json({ error: 'Failed to load public forms' });
  }
});


/**
 * POST /public-forms/seed
 * Ensures the default set of public forms exists for the current project.
 * Creates (upserts) 4 default forms: lead, donation, booking, feedback.
 */
router.post('/seed', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const projectId = user.projectId;

    const defaults: Array<{ formKey: string; title: string; type: string }> = [
      { formKey: 'lead', title: 'Залишити запит', type: 'lead' },
      { formKey: 'donation', title: 'Пожертвування', type: 'donation' },
      { formKey: 'booking', title: 'Бронювання', type: 'booking' },
      { formKey: 'feedback', title: 'Відгук', type: 'feedback' },
    ];

    for (const d of defaults) {
      const existing = await prisma.publicForm.findFirst({
        where: { projectId, formKey: d.formKey },
        select: { id: true },
      });

      if (!existing) {
        await prisma.publicForm.create({
          data: {
            projectId,
            formKey: d.formKey,
            type: d.type,
            title: d.title,
            isActive: true,
          },
        });
      } else {
        await prisma.publicForm.update({
          where: { id: existing.id },
          data: {
            // Keep user changes if they already exist (do not overwrite title/isActive/config)
            type: d.type,
          },
        });
      }
    }

    const forms = await prisma.publicForm.findMany({
      where: { projectId },
      orderBy: { formKey: 'asc' },
    });

    return res.json(forms);
  } catch (error: any) {
    console.error('Error seeding public forms', error);
    return res.status(500).json({ error: 'Failed to seed public forms' });
  }
});

const updatePublicFormSchema = z.object({
  title: z.string().min(1, 'title is required').max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * PATCH /public-forms/:id
 * Allows updating title/description/isActive of a public form for the current project.
 */
router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid form id' });
    }

    const parsed = updatePublicFormSchema.parse(req.body);

    const updated = await prisma.publicForm.updateMany({
      where: {
        id,
        projectId: user.projectId,
      },
      data: {
        title: parsed.title,
        description: parsed.description,
        isActive: parsed.isActive,
      },
    });

    if (updated.count === 0) {
      return res.status(404).json({ error: 'Form not found for this project' });
    }

    const form = await prisma.publicForm.findUnique({
      where: { id },
    });

    return res.json(form);
  } catch (error: any) {
    console.error('Error updating public form', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid form payload',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to update public form' });
  }
});

export default router;
