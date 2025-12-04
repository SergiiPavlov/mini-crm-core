import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, AuthUser } from '../types/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-mini-crm-secret';

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
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

    const user: AuthUser = {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
      projectId: payload.projectId,
    };

    req.user = user;
    return next();
  } catch (error) {
    console.error('Auth error', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
