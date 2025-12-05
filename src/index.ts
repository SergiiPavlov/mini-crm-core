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

const app = express();

// ---------- CORS (dev-friendly, prod-configurable) ----------
const allowedOriginsRaw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '';
let allowedOrigins: string[] | undefined;

if (allowedOriginsRaw) {
  allowedOrigins = allowedOriginsRaw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser / same-origin / file:// requests
      if (!origin || !allowedOrigins || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

// ---------- Body parsing ----------
app.use(express.json());

// ---------- Rate limiting (basic security hardening) ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // max attempts per IP in window
  standardHeaders: true,
  legacyHeaders: false,
});

const publicFormsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // max public form submits per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply before routers
app.use('/auth/login', authLimiter);
app.use('/auth/register-owner', authLimiter);
app.use('/public/forms', publicFormsLimiter);

// ---------- Static widget (lead form) ----------
const widgetPath = path.join(__dirname, '..', 'public', 'widget');
app.use('/widget', express.static(widgetPath));
const adminPath = path.join(__dirname, '..', 'public', 'admin');
app.use('/admin', express.static(adminPath));



// ---------- Health check ----------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'mini-crm-core backend is running' });
});

// ---------- Routers ----------
app.use('/projects', projectsRouter);
app.use('/auth', authRouter);
app.use('/contacts', contactsRouter);
app.use('/', tasksRouter);
app.use('/cases', casesRouter);
app.use('/transactions', transactionsRouter);
app.use('/public', publicRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CRM API running on port ${PORT}`);
});
