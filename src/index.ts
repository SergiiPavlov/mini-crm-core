import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import rateLimit from 'express-rate-limit';

import prisma from './db/client';

import projectsRouter from './routes/projects';
import authRouter from './routes/auth';
import contactsRouter from './routes/contacts';
import tasksRouter from './routes/tasks';
import casesRouter from './routes/cases';
import transactionsRouter from './routes/transactions';
import publicRouter from './routes/public';
import publicFormsRouter from './routes/publicForms';
import invitesRouter from './routes/invites';

const app = express();

// ---------- CORS (multi-site allowlist) ----------
// Legacy ENV allowlist (kept for backward compatibility)
// CORS_ORIGINS="https://site1.com,https://site2.com"
const corsOriginsEnv = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

type OriginsCacheEntry = { origins: string[]; ts: number };
const originsCache = new Map<string, OriginsCacheEntry>();
const ORIGINS_CACHE_TTL_MS = Number(process.env.ORIGINS_CACHE_TTL_MS || 5 * 60 * 1000);

function extractProjectSlugFromPublicPath(pathname: string): string | null {
  // Supported:
  // - /public/:projectSlug/...
  // - /public-forms/:projectSlug/...
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] === 'public') return parts[1] || null;
  if (parts[0] === 'public-forms') return parts[1] || null;
  return null;
}

async function getAllowedOriginsForProjectSlug(projectSlug: string): Promise<string[] | null> {
  const cached = originsCache.get(projectSlug);
  const now = Date.now();
  if (cached && now - cached.ts < ORIGINS_CACHE_TTL_MS) {
    return cached.origins;
  }

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true },
  });
  if (!project) return null;

  const rows = await prisma.projectAllowedOrigin.findMany({
    where: { projectId: project.id },
    select: { origin: true },
    orderBy: { id: 'asc' },
  });
  const origins = rows.map((r) => r.origin);
  originsCache.set(projectSlug, { origins, ts: now });
  return origins;
}

app.use(
  cors((req, cb) => {
    const origin = req.header('Origin');
    const pathname = (req.originalUrl || '').split('?')[0] || '';
    const projectSlug = extractProjectSlugFromPublicPath(pathname);

    // allow server-to-server requests / curl (no Origin)
    if (!origin) {
      return cb(null, {
        origin: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Project-Key', 'X-Request-Id'],
      });
    }

    (async () => {
      // Public endpoints: prefer per-project allowlist from DB.
      if (projectSlug) {
        const allowlist = await getAllowedOriginsForProjectSlug(projectSlug);
        if (allowlist === null) {
          // Unknown project — we still allow CORS preflight to return 404 on handler.
          return cb(null, {
            origin: true,
            methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Project-Key', 'X-Request-Id'],
          });
        }

        // If project has explicit allowlist — enforce it.
        if (allowlist.length > 0) {
          if (allowlist.includes(origin)) {
            return cb(null, {
              origin: true,
              methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
              allowedHeaders: ['Content-Type', 'Authorization', 'X-Project-Key', 'X-Request-Id'],
            });
          }
          return cb(new Error('CORS_NOT_ALLOWED'));
        }

        // If no per-project allowlist configured, fall back to ENV list; otherwise allow all (dev-friendly).
        if (corsOriginsEnv.length === 0 || corsOriginsEnv.includes(origin)) {
          return cb(null, {
            origin: true,
            methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Project-Key', 'X-Request-Id'],
          });
        }
        return cb(new Error('CORS_NOT_ALLOWED'));
      }

      // Private/admin endpoints: use ENV allowlist (or allow all if empty).
      if (corsOriginsEnv.length === 0 || corsOriginsEnv.includes(origin)) {
        return cb(null, {
          origin: true,
          methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Project-Key', 'X-Request-Id'],
        });
      }
      return cb(new Error('CORS_NOT_ALLOWED'));
    })().catch((e) => {
      console.error('CORS options delegate failed', e);
      // Fail-open in case of DB issues in dev; in prod you may want fail-closed.
      return cb(null, {
        origin: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Project-Key', 'X-Request-Id'],
      });
    });
  })
);

// ---------- Middleware: body parsers, rate limiting ----------
// NOTE: Keep body limits strict for public endpoints safety.
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
});

app.use(limiter);

// ---------- Static assets (admin UI + widgets) ----------

const publicDir = path.join(__dirname, '..', 'public');

app.use('/admin', express.static(path.join(publicDir, 'admin')));
app.use('/widget', express.static(path.join(publicDir, 'widget')));

// ---------- Simple healthcheck ----------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---------- Routers ----------

app.use('/projects', projectsRouter);
app.use('/auth', authRouter);
app.use('/invites', invitesRouter);
app.use('/contacts', contactsRouter);
app.use('/', tasksRouter);
app.use('/cases', casesRouter);
app.use('/transactions', transactionsRouter);
app.use('/public', publicRouter);
app.use('/public-forms', publicFormsRouter);


// ---------- CORS error handling ----------
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.message === 'CORS_NOT_ALLOWED') {
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }
  return next(err);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CRM API running on port ${PORT}`);
});
