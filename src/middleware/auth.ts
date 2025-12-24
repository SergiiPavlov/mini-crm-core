import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, AuthUser } from '../types/auth';
import prisma from '../db/client';

const JWT_SECRET = process.env.JWT_SECRET as string;

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.substring('Bearer '.length);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId: number;
      email: string;
      role: string;
      projectId: number;
    };

    // Hard isolation: verify membership exists for (userId, projectId)
    const membership = await prisma.membership.findFirst({
      where: {
        userId: payload.userId,
        projectId: payload.projectId,
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Forbidden (no project access)' });
    }

    const user: AuthUser = {
      id: payload.userId,
      email: payload.email,
      role: membership.role,
      projectId: payload.projectId,
    };

    req.user = user;
    return next();
  } catch (error) {
    console.error('Auth error', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
