import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { AuthRequest } from '../types/auth';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-mini-crm-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload: { userId: number; email: string; role: string; projectId: number }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

const registerOwnerSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  projectSlug: z.string().min(1, 'projectSlug is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

// POST /auth/register-owner — create first owner for a project
router.post('/register-owner', async (req, res) => {
  try {
    const parsed = registerOwnerSchema.parse(req.body);

    const project = await prisma.project.findUnique({
      where: { slug: parsed.projectSlug },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const existingUsers = await prisma.user.count({
      where: { projectId: project.id },
    });

    if (existingUsers > 0) {
      return res.status(400).json({ error: 'Owner already exists for this project' });
    }

    const passwordHash = await bcrypt.hash(parsed.password, 10);

    const user = await prisma.user.create({
      data: {
        email: parsed.email,
        password: passwordHash,
        role: 'owner',
        projectId: project.id,
      },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      projectId: user.projectId,
    });

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        projectId: user.projectId,
      },
    });
  } catch (error) {
    console.error('Failed to register owner', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid payload',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to register owner' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: parsed.email },
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(parsed.password, (user as any).password);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      projectId: user.projectId,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        projectId: user.projectId,
      },
    });
  } catch (error) {
    console.error('Failed to login', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid payload',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to login' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  return res.json({ user: req.user });
});

export default router;
