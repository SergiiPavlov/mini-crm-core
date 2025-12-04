import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db/client';
import { AuthRequest } from '../types/auth';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-mini-crm-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload: { userId: number; email: string; role: string; projectId: number }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// POST /auth/register-owner
// Body: { email, password, projectSlug }
router.post('/register-owner', async (req, res) => {
  try {
    const { email, password, projectSlug } = req.body;

    if (!email || !password || !projectSlug) {
      return res.status(400).json({ error: 'email, password and projectSlug are required' });
    }

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
  } catch (error) {
    console.error('Error in /auth/register-owner', error);
    return res.status(500).json({ error: 'Failed to register owner' });
  }
});

// POST /auth/login
// Body: { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

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
  } catch (error) {
    console.error('Error in /auth/login', error);
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
