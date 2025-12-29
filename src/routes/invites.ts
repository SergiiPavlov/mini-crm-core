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


const createInviteSchema = z
  .object({
    role: z.enum(['owner', 'admin', 'viewer']).optional().default('admin'),
    // Back-compat: older clients used `expiresInDays`.
    expiresInDays: z.number().int().positive().max(365).optional(),
    // Newer clients (and our docs/scripts) use `ttlHours` for more control.
    ttlHours: z.number().int().positive().max(24 * 365).optional(),
  })
  .transform((v) => {
    const ttlHours = typeof v.ttlHours === 'number' ? v.ttlHours : undefined;
    const expiresInDays = typeof v.expiresInDays === 'number' ? v.expiresInDays : undefined;

    // Priority: ttlHours → expiresInDays → default 7d
    const normalizedTtlHours = ttlHours ?? (expiresInDays ?? 7) * 24;
    return {
      role: v.role ?? 'admin',
      ttlHours: normalizedTtlHours,
    };
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
    const expiresAt = new Date(Date.now() + parsed.ttlHours * 60 * 60 * 1000);

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

// GET /invites/public/:token/status — public helper for the admin UI to check invite link state
// Returns 404 if invite not found; otherwise 200 with { status: 'valid' | 'used' | 'expired', role, expiresAt }
router.get('/public/:token/status', async (req, res) => {
  try {
    const inviteToken = normalizeInviteToken(req.params.token);
    const now = new Date();

    const invite = await prisma.projectInvite.findUnique({ where: { token: inviteToken } });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    if (invite.usedAt) {
      return res.json({ status: 'used', role: invite.role, expiresAt: invite.expiresAt });
    }

    if (invite.expiresAt && invite.expiresAt.getTime() < now.getTime()) {
      return res.json({ status: 'expired', role: invite.role, expiresAt: invite.expiresAt });
    }

    return res.json({ status: 'valid', role: invite.role, expiresAt: invite.expiresAt });
  } catch (error) {
    console.error('Failed to check invite status', error);
    return res.status(500).json({ error: 'Failed to check invite status' });
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

    // Pre-check password if the user exists. We do this BEFORE consuming the invite,
    // so a wrong password doesn't burn a one-time link.
    const existingUser = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (existingUser) {
      const ok = await bcrypt.compare(parsed.password, (existingUser as any).password || '');
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.projectInvite.findUnique({ where: { token: inviteToken } });

      if (!invite) {
        return { kind: 'not_found' as const };
      }

      if (invite.expiresAt && invite.expiresAt.getTime() < now.getTime()) {
        return { kind: 'expired' as const, invite };
      }

      // Atomic claim: only one request can flip usedAt from NULL → now.
      const claim = await tx.projectInvite.updateMany({
        where: {
          id: invite.id,
          usedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: { usedAt: now },
      });

      if (claim.count === 0) {
        // Someone else already used it (or it expired between checks)
        const fresh = await tx.projectInvite.findUnique({ where: { id: invite.id } });
        if (fresh?.expiresAt && fresh.expiresAt.getTime() < now.getTime()) {
          return { kind: 'expired' as const, invite: fresh };
        }
        return { kind: 'used' as const, invite: fresh || invite };
      }

      // get or create user
      let user = existingUser
        ? await tx.user.findUnique({ where: { email: existingUser.email } })
        : await tx.user.findUnique({ where: { email: parsed.email } });

      if (!user) {
        const passwordHash = await bcrypt.hash(parsed.password, 10);
        try {
          user = await tx.user.create({
            data: { email: parsed.email, password: passwordHash },
          });
        } catch (e: any) {
          // Race: user might have been created concurrently. Re-read.
          user = await tx.user.findUnique({ where: { email: parsed.email } });
          if (!user) throw e;
        }
      }

      // ensure membership (idempotent)
      await tx.membership.upsert({
        where: { userId_projectId: { userId: (user as any).id, projectId: invite.projectId } },
        update: { role: invite.role },
        create: {
          projectId: invite.projectId,
          userId: (user as any).id,
          role: invite.role,
        },
      });

      // attach who used it (best-effort, still idempotent)
      await tx.projectInvite.update({
        where: { id: invite.id },
        data: { usedByUserId: (user as any).id },
      });

      const jwtToken = signToken({
        userId: (user as any).id,
        email: (user as any).email,
        role: invite.role,
        projectId: invite.projectId,
      });

      return {
        kind: 'ok' as const,
        invite,
        token: jwtToken,
        user: {
          id: (user as any).id,
          email: (user as any).email,
          role: invite.role,
          projectId: invite.projectId,
        },
      };
    });

    if (result.kind === 'not_found') return res.status(404).json({ error: 'Invite not found' });
    if (result.kind === 'used') return res.status(409).json({ error: 'Invite already used' });
    if (result.kind === 'expired') return res.status(410).json({ error: 'Invite expired' });

    return res.json({ token: result.token, user: result.user });
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
      if (invite.usedByUserId === req.user.id) {
        return res.json({
          ok: true,
          projectId: invite.projectId,
          role: invite.role,
        });
      }
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
