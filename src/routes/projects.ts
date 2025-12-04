import express from 'express';
import prisma from '../db/client';

const router = express.Router();

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
    const { name, slug, config } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }

    const project = await prisma.project.create({
      data: {
        name,
        slug,
        config: config ?? null,
      },
    });

    res.status(201).json(project);
  } catch (error: any) {
    console.error('Error creating project', error);
    // Handle unique constraint on slug
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Project slug already exists' });
    }
    res.status(500).json({ error: 'Failed to create project' });
  }
});

export default router;
