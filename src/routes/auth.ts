import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { SignOptions } from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { AuthRequest } from '../types/auth';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

const JWT_SECRET = (process.env.JWT_SECRET || 'dev-mini-crm-secret') as jwt.Secret;
const JWT_EXPIRES_IN: SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']) || '7d';

function signToken(payload: { userId: number; email: string; role: string; projectId: number }) {
  // role + projectId are the CURRENT active project in the admin UI
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

const registerOwnerSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  projectSlug: z.string().min(1, 'projectSlug is required'),
});
const bootstrapOwnerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  projectSlug: z.string().min(2),
  projectName: z.string().min(2).optional(),
});

const registerUserSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

function pickPrimaryMembership(memberships: Array<{ role: string; projectId: number }>) {
  const priority: Record<string, number> = { owner: 0, admin: 1, viewer: 2 };
  return [...memberships].sort((a, b) => (priority[a.role] ?? 99) - (priority[b.role] ?? 99))[0];
}

// POST /auth/register — create a global user account (no project binding)
router.post('/register', async (req, res) => {
  try {
    const parsed = registerUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(parsed.password, 10);
    const user = await prisma.user.create({
      data: {
        email: parsed.email,
        password: passwordHash,
      },
    });

    return res.status(201).json({
      user: { id: user.id, email: user.email },
    });
  } catch (error) {
    console.error('Failed to register user', error);

    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }

    return res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST /auth/register-owner — create first owner for a project

router.post('/bootstrap-owner', async (req, res) => {
  const parsed = bootstrapOwnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;
  const projectSlug = parsed.data.projectSlug.trim().toLowerCase();
  const projectName = (parsed.data.projectName || projectSlug).trim();

  // Security: avoid "claiming" an existing user/project.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return res.status(409).json({ error: 'User already exists' });
  }

  let project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (project) {
    const membersCount = await prisma.membership.count({ where: { projectId: project.id } });
    if (membersCount > 0) {
      return res.status(409).json({ error: 'Project already initialized' });
    }
  } else {
    project = await prisma.project.create({
      data: {
        name: projectName,
        slug: projectSlug,
        publicKey: crypto.randomBytes(24).toString('hex'),
      },
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  await prisma.membership.create({
    data: { userId: user.id, projectId: project.id, role: 'owner' },
  });

  const token = signToken({ userId: user.id, email: user.email, role: 'owner', projectId: project.id });

  return res.status(201).json({
    token,
    user: { id: user.id, email: user.email, role: 'owner', projectId: project.id },
    project: { id: project.id, name: project.name, slug: project.slug, publicKey: project.publicKey },
  });
});

router.post('/register-owner', async (req, res) => {
  try {
    const parsed = registerOwnerSchema.parse(req.body);

    const project = await prisma.project.findUnique({
      where: { slug: parsed.projectSlug },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const existingOwners = await prisma.membership.count({
      where: { projectId: project.id, role: 'owner' },
    });

    if (existingOwners > 0) {
      return res.status(400).json({ error: 'Owner already exists for this project' });
    }

    const passwordHash = await bcrypt.hash(parsed.password, 10);

    const existingUser = await prisma.user.findUnique({
      where: { email: parsed.email },
      select: { id: true },
    });

    if (existingUser) {
      // Security: do not overwrite password for an existing account.
      return res.status(409).json({ error: 'User already exists' });
    }

    const user = await prisma.user.create({
      data: {
        email: parsed.email,
        password: passwordHash,
      },
    });

    await prisma.membership.create({
      data: {
        userId: user.id,
        projectId: project.id,
        role: 'owner',
      },
    });

    // Set createdByUserId if not set
    if (!project.createdByUserId) {
      await prisma.project.update({
        where: { id: project.id },
        data: { createdByUserId: user.id },
      });
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: 'owner',
      projectId: project.id,
    });

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: 'owner',
        projectId: project.id,
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
      include: {
        memberships: true,
      },
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(parsed.password, (user as any).password);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const memberships = (user as any).memberships as Array<{ role: string; projectId: number }>;
    if (!memberships || memberships.length === 0) {
      return res.status(403).json({ error: 'No project access for this user' });
    }

    const primary = pickPrimaryMembership(memberships);

    const token = signToken({
      userId: (user as any).id,
      email: (user as any).email,
      role: primary.role,
      projectId: primary.projectId,
    });

    return res.json({
      token,
      user: {
        id: (user as any).id,
        email: (user as any).email,
        role: primary.role,
        projectId: primary.projectId,
      },
      memberships: memberships.map((m) => ({ projectId: m.projectId, role: m.role })),
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