import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import rateLimit from 'express-rate-limit';

import projectsRouter from './routes/projects';
import authRouter from './routes/auth';
import contactsRouter from './routes/contacts';
import tasksRouter from './routes/tasks';
import casesRouter from './routes/cases';
import transactionsRouter from './routes/transactions';
import publicRouter from './routes/public';
import publicFormsRouter from './routes/publicForms';

const app = express();

// ---------- CORS (multi-site allowlist) ----------
// CORS_ORIGINS="https://site1.com,https://site2.com"
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // allow server-to-server requests / curl (no Origin)
      if (!origin) return cb(null, true);
      // if no allowlist provided, allow all (dev-friendly)
      if (corsOrigins.length === 0) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS_NOT_ALLOWED'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Project-Key', 'X-Request-Id'],
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
