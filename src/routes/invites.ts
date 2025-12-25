import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types/auth';

const router = express.Router();

const JWT_SECRET = (process.env.JWT_SECRET || 'dev-mini-crm-secret') as jwt.Secret;
const JWT_EXPIRES_IN: SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']) || '7d';

function signToken(payload: { userId: number; email: string; role: string; projectId: number }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function normalizeInviteToken(input: unknown): string {
  // The admin UI may carry tokens wrapped in angle brackets from URLs (e.g. "<abc123>").
  // Normalize on the server to avoid confusing 404/"Invite not found" when the token is correct.
  return String(input ?? '')
    .trim()
    .replace(/^[<\s]+/, '')
    .replace(/[>\s]+$/, '');
}


const createInviteSchema = z.object({
  role: z.enum(['owner', 'admin', 'viewer']).optional().default('admin'),
  expiresInDays: z.number().int().positive().max(365).optional().default(7),
});

const acceptInviteSchema = z.object({
  token: z.string().min(8, 'token is required'),
});

const acceptInvitePublicSchema = z.object({
  token: z.string().min(8, 'token is required'),
  email: z.string().email('email is required'),
  password: z.string().min(6, 'password is required'),
});

function assertProjectAdmin(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

// POST /invites — create invite token for current project
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!assertProjectAdmin(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = createInviteSchema.parse(req.body || {});

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000);

    const invite = await prisma.projectInvite.create({
      data: {
        projectId: req.user.projectId,
        token,
        role: parsed.role,
        expiresAt,
        createdByUserId: req.user.id,
      },
    });

    return res.status(201).json({
      token: invite.token,
      role: invite.role,
      expiresAt: invite.expiresAt,
    });
  } catch (error) {
    console.error('Failed to create invite', error);

    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }

    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

// GET /invites — list active (unused) invites for current project
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!assertProjectAdmin(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date();

    const invites = await prisma.projectInvite.findMany({
      where: {
        projectId: req.user.projectId,
        usedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(
      invites.map((i) => ({
        token: i.token,
        role: i.role,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      }))
    );
  } catch (error) {
    console.error('Failed to list invites', error);
    return res.status(500).json({ error: 'Failed to list invites' });
  }
});


// POST /invites/accept-public — accept invite for a user that is not logged in yet.
// This endpoint can create the user (if not exists) and will create Membership + return JWT token.
// Payload: { token, email, password }
router.post('/accept-public', async (req, res) => {
  try {
		const parsed = acceptInvitePublicSchema.parse(req.body || {});
		const inviteToken = normalizeInviteToken(parsed.token);
    const now = new Date();

    const invite = await prisma.projectInvite.findFirst({
      where: {
        token: inviteToken,
        usedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found or expired' });
    }

    // get or create user
    let user = await prisma.user.findUnique({
      where: { email: parsed.email },
      include: { memberships: true },
    });

    if (user) {
      // verify password
      const ok = await bcrypt.compare(parsed.password, (user as any).password || '');
      if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
      const passwordHash = await bcrypt.hash(parsed.password, 10);
      user = await prisma.user.create({
        data: { email: parsed.email, password: passwordHash },
        include: { memberships: true },
      });
    }

    // ensure membership
    const existing = (user as any).memberships?.find((m: any) => m.projectId === invite.projectId);
    if (!existing) {
      await prisma.membership.create({
        data: {
          projectId: invite.projectId,
          userId: (user as any).id,
          role: invite.role,
        },
      });
    }

    // mark invite used
    await prisma.projectInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), usedByUserId: (user as any).id },
    });

    const jwtToken = signToken({
      userId: (user as any).id,
      email: (user as any).email,
      role: invite.role,
      projectId: invite.projectId,
    });

    return res.json({
      token: jwtToken,
      user: {
        id: (user as any).id,
        email: (user as any).email,
        role: invite.role,
        projectId: invite.projectId,
      },
    });
  } catch (error) {
    console.error('Failed to accept invite (public)', error);

    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }

    return res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// POST /invites/accept — accept invite and join project
router.post('/accept', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = acceptInviteSchema.parse(req.body || {});
    const inviteToken = normalizeInviteToken(parsed.token);

    const invite = await prisma.projectInvite.findUnique({
      where: { token: inviteToken },
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    if (invite.usedAt) {
      return res.status(409).json({ error: 'Invite already used' });
    }

    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ error: 'Invite expired' });
    }

    // If user already has membership, just mark invite used (idempotent-ish)
    await prisma.membership.upsert({
      where: {
        userId_projectId: {
          userId: req.user.id,
          projectId: invite.projectId,
        },
      },
      update: {
        role: invite.role,
      },
      create: {
        userId: req.user.id,
        projectId: invite.projectId,
        role: invite.role,
      },
    });

    await prisma.projectInvite.update({
      where: { id: invite.id },
      data: {
        usedAt: new Date(),
        usedByUserId: req.user.id,
      },
    });

    return res.json({
      ok: true,
      projectId: invite.projectId,
      role: invite.role,
    });
  } catch (error) {
    console.error('Failed to accept invite', error);

    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }

    return res.status(500).json({ error: 'Failed to accept invite' });
  }
});

export default router;
