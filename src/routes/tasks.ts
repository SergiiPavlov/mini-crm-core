import express from 'express';
import { z, ZodError } from 'zod';
import prisma from '../db/client';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types/auth';

const router = express.Router();

const createTaskSchema = z.object({
  title: z.string().min(1, 'title is required').max(255),
});

const updateTaskSchema = z
  .object({
    title: z.string().max(255).optional(),
    done: z.boolean().optional(),
  })
  .refine(
    (data) => data.title !== undefined || data.done !== undefined,
    {
      message: 'At least one field must be provided',
      path: ['title'],
    }
  );

// GET /cases/:id/tasks - list tasks for a case
router.get('/cases/:id/tasks', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const caseId = Number(req.params.id);

    if (!caseId || Number.isNaN(caseId)) {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    const existingCase = await prisma.case.findFirst({
      where: {
        id: caseId,
        projectId,
      },
      select: { id: true },
    });

    if (!existingCase) {
      return res.status(404).json({ error: 'Case not found for this project' });
    }

    const tasks = await prisma.task.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    });

    return res.json(tasks);
  } catch (error: any) {
    console.error('Error listing tasks', error);
    return res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// POST /cases/:id/tasks - create task for a case
router.post('/cases/:id/tasks', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const caseId = Number(req.params.id);

    if (!caseId || Number.isNaN(caseId)) {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    const parsed = createTaskSchema.parse(req.body);

    const existingCase = await prisma.case.findFirst({
      where: {
        id: caseId,
        projectId,
      },
      select: { id: true },
    });

    if (!existingCase) {
      return res.status(404).json({ error: 'Case not found for this project' });
    }

    const task = await prisma.task.create({
      data: {
        title: parsed.title.trim(),
        caseId,
      },
    });

    return res.status(201).json(task);
  } catch (error: any) {
    console.error('Error creating task', error);

    if (error instanceof ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Validation error' });
    }

    return res.status(500).json({ error: 'Failed to create task' });
  }
});

// PATCH /tasks/:taskId - update task
router.patch('/tasks/:taskId', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const taskId = Number(req.params.taskId);

    if (!taskId || Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const parsed = updateTaskSchema.parse(req.body);

    // ensure task belongs to a case of this project
    const existingTask = await prisma.task.findFirst({
      where: {
        id: taskId,
        case: {
          projectId,
        },
      },
      select: { id: true },
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found for this project' });
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: parsed,
    });

    return res.json(updated);
  } catch (error: any) {
    console.error('Error updating task', error);

    if (error instanceof ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Validation error' });
    }

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /tasks/:taskId - delete task
router.delete('/tasks/:taskId', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectId = req.user.projectId;
    const taskId = Number(req.params.taskId);

    if (!taskId || Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    // ensure task belongs to a case of this project
    const existingTask = await prisma.task.findFirst({
      where: {
        id: taskId,
        case: {
          projectId,
        },
      },
      select: { id: true },
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found for this project' });
    }

    await prisma.task.delete({
      where: { id: taskId },
    });

    return res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting task', error);

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
