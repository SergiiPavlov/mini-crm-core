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
  email: z.string().email('Valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  projectSlug: z.string().min(1, 'projectSlug is required'),
});

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'password is required'),
});

// POST /auth/register-owner
// Body: { email, password, projectSlug }
router.post('/register-owner', async (req, res) => {
  try {
    const { email, password, projectSlug } = registerOwnerSchema.parse(req.body);

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
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
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        projectId: user.projectId,
      },
      token,
    });
  } catch (error: any) {
    console.error('Error in /auth/register-owner', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to register owner' });
  }
});

// POST /auth/login
// Body: { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      projectId: user.projectId,
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        projectId: user.projectId,
      },
      token,
    });
  } catch (error: any) {
    console.error('Error in /auth/login', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
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
