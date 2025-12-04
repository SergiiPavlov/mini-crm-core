import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import projectsRouter from './routes/projects';
import authRouter from './routes/auth';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'mini-crm-core backend is running' });
});

app.use('/projects', projectsRouter);
app.use('/auth', authRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CRM API running on port ${PORT}`);
});
