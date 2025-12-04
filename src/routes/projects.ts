import express from 'express';
import { z, ZodError } from 'zod';
import prisma from '../db/client';

const router = express.Router();

const createProjectSchema = z.object({
  name: z.string().min(1, 'name is required'),
  slug: z
    .string()
    .min(1, 'slug is required')
    .regex(/^[a-z0-9-]+$/i, 'slug can contain letters, numbers and dashes only'),
});

// GET /projects - list all projects
router.get('/', async (_req, res) => {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// POST /projects - create a new project
router.post('/', async (req, res) => {
  try {
    const { name, slug } = createProjectSchema.parse(req.body);

    const project = await prisma.project.create({
      data: {
        name,
        slug,
      },
    });

    res.status(201).json(project);
  } catch (error: any) {
    console.error('Error creating project', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    // Handle unique constraint on slug
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Project slug already exists' });
    }
    res.status(500).json({ error: 'Failed to create project' });
  }
});

export default router;
