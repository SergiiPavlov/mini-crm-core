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

// ---------- Middleware: CORS, body parsers, rate limiting ----------

const allowedOrigin = process.env.CORS_ORIGIN || '*';

app.use(
  cors({
    origin: allowedOrigin === '*' ? true : allowedOrigin,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CRM API running on port ${PORT}`);
});
