import express from 'express';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types/auth';

const JWT_SECRET = (process.env.JWT_SECRET || 'dev-mini-crm-secret') as jwt.Secret;
const JWT_EXPIRES_IN: SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']) || '7d';

function signToken(payload: { userId: number; email: string; role: string; projectId: number }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

const router = express.Router();

const MembershipRoleSchema = z.enum(['owner', 'admin', 'viewer']);

function requireRole(req: AuthRequest, res: express.Response, roles: Array<'owner' | 'admin' | 'viewer'>) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!roles.includes(user.role as any)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

const createProjectSchema = z.object({
  name: z.string().min(1, 'name is required'),
  slug: z
    .string()
    .min(1, 'slug is required')
    .regex(/^[a-z0-9-]+$/i, 'slug can contain letters, numbers and dashes only'),
});

const caseStatusConfigItemSchema = z.object({
  code: z.string().min(1, 'code is required'),
  label: z.string().min(1, 'label is required'),
  rowBg: z.string().min(1, 'rowBg is required').optional().nullable(),
});

const transactionCategoryConfigItemSchema = z.object({
  code: z.string().min(1, 'code is required'),
  label: z.string().min(1, 'label is required'),
  color: z.string().min(1, 'color is required'),
  type: z.enum(['income', 'expense']),
  order: z.number().int().nonnegative().optional(),
});

const updateProjectConfigSchema = z
  .object({
    caseStatuses: z
      .array(caseStatusConfigItemSchema)
      .min(1, 'at least one status is required')
      .optional(),
    notifications: z
      .object({
        emails: z.array(z.string().email()).optional(),
        notifyOnLead: z.boolean().optional(),
        notifyOnDonation: z.boolean().optional(),
        notifyOnBooking: z.boolean().optional(),
        notifyOnFeedback: z.boolean().optional(),
      })
      .partial()
      .optional(),
    transactionCategories: z
      .array(transactionCategoryConfigItemSchema)
      .min(1, 'at least one transaction category is required')
      .optional(),
  })
  .refine(
    (data) =>
      data.caseStatuses ||
      data.notifications ||
      data.transactionCategories,
    {
      message: 'At least one config section must be provided',
    }
  );

export const DEFAULT_PROJECT_CONFIG = {
  caseStatuses: [
    { code: 'new', label: 'Новий', rowBg: '#fef2f2' },
    { code: 'in_progress', label: 'В прогресі', rowBg: '#fffbeb' },
    { code: 'done', label: 'Завершено', rowBg: '#ecfdf3' },
  ],
  notifications: {
    emails: [],
    notifyOnLead: true,
    notifyOnDonation: true,
    notifyOnBooking: true,
    notifyOnFeedback: true,
  },
  transactionCategories: [
    { code: 'donation', label: 'Пожертвування', color: '#3b82f6', type: 'income', order: 1 },
    { code: 'service', label: 'Послуга', color: '#22c55e', type: 'income', order: 2 },
    { code: 'refund', label: 'Повернення', color: '#ef4444', type: 'expense', order: 3 },
  ],
};

type ProjectConfigUpdateInput = z.infer<typeof updateProjectConfigSchema>;

function buildNextProjectConfig(existingConfig: any, parsed: ProjectConfigUpdateInput): any {
  let base: any = {};
  if (existingConfig && typeof existingConfig === 'object') {
    base = { ...existingConfig };
  }

  if (parsed.caseStatuses) {
    base.caseStatuses = parsed.caseStatuses.map((item) => ({
      code: item.code,
      label: item.label,
      rowBg:
        item.rowBg ??
        existingConfig?.caseStatuses?.find((s: any) => s.code === item.code)?.rowBg ??
        undefined,
    }));
  }

  if (parsed.notifications) {
    const existingNotifications = (existingConfig && (existingConfig as any).notifications) || {};
    base.notifications = {
      emails: parsed.notifications.emails ?? existingNotifications.emails ?? [],
      notifyOnLead:
        typeof parsed.notifications.notifyOnLead === 'boolean'
          ? parsed.notifications.notifyOnLead
          : existingNotifications.notifyOnLead ?? DEFAULT_PROJECT_CONFIG.notifications.notifyOnLead,
      notifyOnDonation:
        typeof parsed.notifications.notifyOnDonation === 'boolean'
          ? parsed.notifications.notifyOnDonation
          : existingNotifications.notifyOnDonation ??
            DEFAULT_PROJECT_CONFIG.notifications.notifyOnDonation,
      notifyOnBooking:
        typeof parsed.notifications.notifyOnBooking === 'boolean'
          ? parsed.notifications.notifyOnBooking
          : existingNotifications.notifyOnBooking ??
            DEFAULT_PROJECT_CONFIG.notifications.notifyOnBooking,
      notifyOnFeedback:
        typeof parsed.notifications.notifyOnFeedback === 'boolean'
          ? parsed.notifications.notifyOnFeedback
          : existingNotifications.notifyOnFeedback ??
            DEFAULT_PROJECT_CONFIG.notifications.notifyOnFeedback,
    };
  }

  if (parsed.transactionCategories) {
    const existingCategories = (
      Array.isArray(existingConfig?.transactionCategories)
        ? existingConfig.transactionCategories
        : []
    ) as any[];

    base.transactionCategories = parsed.transactionCategories.map((item, index) => {
      const prev = existingCategories.find((c: any) => c.code === item.code) || {};
      return {
        code: item.code,
        label: item.label,
        color: item.color ?? prev.color ?? '#6b7280',
        type: item.type ?? prev.type ?? 'income',
        order:
          typeof item.order === 'number'
            ? item.order
            : typeof prev.order === 'number'
            ? prev.order
            : index + 1,
      };
    });
  }

  return base;
}

function normalizeProjectConfig(rawConfig: any) {
  let config: any = rawConfig && typeof rawConfig === 'object' ? { ...rawConfig } : {};

  if (!Array.isArray(config.caseStatuses) || config.caseStatuses.length === 0) {
    config.caseStatuses = DEFAULT_PROJECT_CONFIG.caseStatuses;
  }

  if (!config.notifications || typeof config.notifications !== 'object') {
    config.notifications = { ...DEFAULT_PROJECT_CONFIG.notifications };
  } else {
    const existing = config.notifications || {};
    config.notifications = {
      emails: Array.isArray(existing.emails) ? existing.emails : [],
      notifyOnLead:
        typeof existing.notifyOnLead === 'boolean'
          ? existing.notifyOnLead
          : DEFAULT_PROJECT_CONFIG.notifications.notifyOnLead,
      notifyOnDonation:
        typeof existing.notifyOnDonation === 'boolean'
          ? existing.notifyOnDonation
          : DEFAULT_PROJECT_CONFIG.notifications.notifyOnDonation,
      notifyOnBooking:
        typeof existing.notifyOnBooking === 'boolean'
          ? existing.notifyOnBooking
          : DEFAULT_PROJECT_CONFIG.notifications.notifyOnBooking,
      notifyOnFeedback:
        typeof existing.notifyOnFeedback === 'boolean'
          ? existing.notifyOnFeedback
          : DEFAULT_PROJECT_CONFIG.notifications.notifyOnFeedback,
    };
  }

  if (
    !Array.isArray(config.transactionCategories) ||
    config.transactionCategories.length === 0
  ) {
    config.transactionCategories = DEFAULT_PROJECT_CONFIG.transactionCategories;
  } else {
    config.transactionCategories = config.transactionCategories
      .map((cat: any, index: number) => {
        const code =
          typeof cat.code === 'string' && cat.code.trim()
            ? cat.code.trim()
            : `category_${index + 1}`;
        const label =
          typeof cat.label === 'string' && cat.label.trim()
            ? cat.label.trim()
            : code;
        const color =
          typeof cat.color === 'string' && cat.color.trim()
            ? cat.color.trim()
            : DEFAULT_PROJECT_CONFIG.transactionCategories[0].color;
        const type = cat.type === 'expense' ? 'expense' : 'income';
        const order =
          typeof cat.order === 'number' ? cat.order : index + 1;

        return { code, label, color, type, order };
      })
      .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  }

  return config;
}

// GET /projects — list projects for current user (membership-based)
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const memberships = await prisma.membership.findMany({
      where: { userId: req.user.id },
      include: { project: true },
      orderBy: { projectId: 'asc' },
    });

    return res.json(
      memberships.map((m) => ({
        projectId: m.projectId,
        role: m.role,
        project: {
          id: m.project.id,
          name: m.project.name,
          slug: m.project.slug,
          publicKey: m.project.publicKey,
          config: m.project.config ?? null,
        },
      }))
    );
  } catch (error) {
    console.error('Failed to list projects', error);
    return res.status(500).json({ error: 'Failed to list projects' });
  }
});

// POST /projects/select — switch active project for the current user (returns a new token)
router.post('/select', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const body = (req.body || {}) as { projectId?: number };
    const projectId = typeof body.projectId === 'number' ? body.projectId : Number(body.projectId);
    if (!projectId || Number.isNaN(projectId)) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: req.user.id, projectId },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const token = signToken({
      userId: req.user.id,
      email: req.user.email,
      role: membership.role,
      projectId,
    });

    return res.json({
      token,
      user: {
        id: req.user.id,
        email: req.user.email,
        role: membership.role,
        projectId,
      },
    });
  } catch (error) {
    console.error('Failed to select project', error);
    return res.status(500).json({ error: 'Failed to select project' });
  }
});

// GET /projects/current — project for current authenticated user
router.get('/current', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const project = await prisma.project.findUnique({
      where: { id: user.projectId },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found for current user' });
    }

    const config = normalizeProjectConfig(project.config ?? {});

    return res.json({
      id: project.id,
      name: project.name,
      slug: project.slug,
      publicKey: project.publicKey,
      config,
    });
  } catch (error) {
    console.error('Failed to load current project', error);
    return res.status(500).json({ error: 'Failed to load current project' });
  }
});

// GET /projects/:slug/config — read config by slug
router.get('/:slug/config', async (req, res) => {
  try {
    const { slug } = req.params;

    const project = await prisma.project.findUnique({
      where: { slug },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const config = normalizeProjectConfig(project.config ?? {});

    return res.json({
      slug: project.slug,
      config,
    });
  } catch (error) {
    console.error('Failed to load project config by slug', error);
    return res.status(500).json({ error: 'Failed to load project config' });
  }
});

// PATCH /projects/current/config — update project config (caseStatuses, notifications, transactionCategories)
router.patch('/current/config', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const parsed = updateProjectConfigSchema.parse(req.body);

    const project = await prisma.project.findUnique({
      where: { id: user.projectId },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found for current user' });
    }

    const existingConfig: any =
      project.config && typeof project.config === 'object' ? project.config : {};

    const nextConfig = buildNextProjectConfig(existingConfig, parsed);

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { config: nextConfig },
    });

    return res.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      config: nextConfig,
    });
  } catch (error) {
    console.error('Failed to update project config', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid config payload',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to update project config' });
  }
});

// PATCH /projects/:slug/config — update config by slug for current user's project
router.patch('/:slug/config', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { slug } = req.params;
    const parsed = updateProjectConfigSchema.parse(req.body);

    const project = await prisma.project.findUnique({
      where: { slug },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.id !== user.projectId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const existingConfig: any =
      project.config && typeof project.config === 'object' ? project.config : {};

    const nextConfig = buildNextProjectConfig(existingConfig, parsed);

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { config: nextConfig },
    });

    return res.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      config: nextConfig,
    });
  } catch (error) {
    console.error('Failed to update project config by slug', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid config payload',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to update project config' });
  }
});

// POST /projects — create a new project
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = createProjectSchema.parse(req.body);

    // Generate a stable random publicKey
    const publicKey = Buffer.from(`${parsed.slug}:${Date.now()}:${Math.random()}`)
      .toString('hex')
      .slice(0, 32);

    const project = await prisma.project.create({
      data: {
        name: parsed.name,
        slug: parsed.slug,
        publicKey,
        config: DEFAULT_PROJECT_CONFIG,
        createdByUserId: req.user.id,
      },
    });

    await prisma.membership.create({
      data: {
        userId: req.user.id,
        projectId: project.id,
        role: 'owner',
      },
    });

    return res.status(201).json({
      id: project.id,
      name: project.name,
      slug: project.slug,
      publicKey: project.publicKey,
      config: project.config,
    });
  } catch (error: any) {
    console.error('Failed to create project', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid project payload',
        details: error.errors,
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Project slug already exists' });
    }

    return res.status(500).json({ error: 'Failed to create project' });
  }
});

// ------------------------------
// P2-min: Integration helpers (per-project allowlist)
// ------------------------------

router.get('/current/integration', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireRole(req, res, ['owner', 'admin', 'viewer'])) return;
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const project = await prisma.project.findUnique({
      where: { id: user.projectId },
      select: { id: true, name: true, slug: true, publicKey: true },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const origins = await prisma.projectAllowedOrigin.findMany({
      where: { projectId: project.id },
      select: { id: true, origin: true, createdAt: true },
      orderBy: { id: 'asc' },
    });

    return res.json({
      project,
      allowedOrigins: origins,
    });
  } catch (error) {
    console.error('Failed to load integration data', error);
    return res.status(500).json({ error: 'Failed to load integration data' });
  }
});

router.get('/current/allowed-origins', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireRole(req, res, ['owner', 'admin', 'viewer'])) return;
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const origins = await prisma.projectAllowedOrigin.findMany({
      where: { projectId: user.projectId },
      select: { id: true, origin: true, createdAt: true },
      orderBy: { id: 'asc' },
    });
    return res.json(origins);
  } catch (error) {
    console.error('Failed to list allowed origins', error);
    return res.status(500).json({ error: 'Failed to list allowed origins' });
  }
});

router.post('/current/allowed-origins', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireRole(req, res, ['owner', 'admin'])) return;
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const origin = typeof req.body?.origin === 'string' ? req.body.origin.trim() : '';
    if (!origin) {
      return res.status(400).json({ error: 'origin is required' });
    }

    // Enforce strict origin format (must include scheme + hostname)
    let normalized = origin;
    try {
      normalized = new URL(origin).origin;
    } catch {
      return res.status(400).json({ error: 'origin must be a valid URL origin (e.g. https://example.com)' });
    }

    const created = await prisma.projectAllowedOrigin.create({
      data: {
        projectId: user.projectId,
        origin: normalized,
      },
      select: { id: true, origin: true, createdAt: true },
    });

    return res.status(201).json(created);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      // Idempotency: origin already in allowlist is not an error.
      return res.status(409).json({ error: 'Origin already exists' });
    }
    console.error('Failed to add allowed origin', error);
    return res.status(500).json({ error: 'Failed to add allowed origin' });
  }
});

router.delete('/current/allowed-origins/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireRole(req, res, ['owner', 'admin'])) return;
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid origin id' });
    }

    const deleted = await prisma.projectAllowedOrigin.deleteMany({
      where: { id, projectId: user.projectId },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Origin not found' });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete allowed origin', error);
    return res.status(500).json({ error: 'Failed to delete allowed origin' });
  }
});

// --- Membership management (P1.1) ---
router.get('/current/members', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    // Any authenticated member can view the list.
    const members = await prisma.membership.findMany({
      where: { projectId: user.projectId },
      include: {
        user: { select: { id: true, email: true } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    return res.json(
      members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        role: m.role,
        createdAt: m.createdAt,
      }))
    );
  } catch (error) {
    console.error('Failed to list members', error);
    return res.status(500).json({ error: 'Failed to list members' });
  }
});

router.patch('/current/members/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireRole(req, res, ['owner'])) return;
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid member id' });
    }

    const bodySchema = z.object({ role: MembershipRoleSchema });
    const { role } = bodySchema.parse(req.body);

    const target = await prisma.membership.findFirst({
      where: { id, projectId: user.projectId },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!target) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Prevent removing the last owner role via role change.
    if (target.role === 'owner' && role !== 'owner') {
      const ownersCount = await prisma.membership.count({
        where: { projectId: user.projectId, role: 'owner' },
      });
      if (ownersCount <= 1) {
        return res.status(409).json({ error: 'Cannot downgrade the last owner' });
      }
    }

    const updated = await prisma.membership.update({
      where: { id },
      data: { role },
      include: { user: { select: { id: true, email: true } } },
    });

    // If the updated membership is the current user, re-issue JWT with new role.
    let token: string | undefined;
    if (updated.userId === user.id) {
      token = signToken({
        userId: user.id,
        email: user.email,
        role: updated.role,
        projectId: user.projectId,
      });
    }

    return res.json({
      member: {
        id: updated.id,
        userId: updated.userId,
        email: updated.user.email,
        role: updated.role,
        createdAt: updated.createdAt,
      },
      token: token || null,
    });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid payload', details: error.flatten() });
    }
    console.error('Failed to update member role', error);
    return res.status(500).json({ error: 'Failed to update member role' });
  }
});

router.delete('/current/members/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!requireRole(req, res, ['owner','admin'])) return;
    const user = req.user;
    if (!user || !user.projectId) {
      return res.status(403).json({ error: 'Project context is required' });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid member id' });
    }

    const target = await prisma.membership.findFirst({ where: { id, projectId: user.projectId } });
    if (!target) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Admin is allowed to remove ONLY viewers. Owner can remove anyone (except last owner).
    if (user.role === 'admin') {
      if (target.role !== 'viewer') {
        return res.status(403).json({ error: 'Admins can remove only viewers' });
      }
    }

    // Prevent deleting the last owner.
    if (target.role === 'owner') {
      const ownersCount = await prisma.membership.count({
        where: { projectId: user.projectId, role: 'owner' },
      });
      if (ownersCount <= 1) {
        return res.status(409).json({ error: 'Cannot remove the last owner' });
      }
    }

    await prisma.membership.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to remove member', error);
    return res.status(500).json({ error: 'Failed to remove member' });
  }
});

export default router;
