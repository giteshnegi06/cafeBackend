/**
 * Staff/admin auth. This backend serves every cafe out of one shared
 * database now (see migrations/005_multi_tenant.sql), so every protected
 * request has to prove which cafe it's acting for — that's what the JWT
 * issued by POST /auth/login carries. Nothing here should ever trust a
 * cafe_id supplied by the client itself; it always comes from the verified
 * token.
 */
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

// Augment Express's Request so `req.cafeId` etc. are usable anywhere in
// api.ts without a cast, once requireAuth has run.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cafeId?: string;
      userId?: string;
      role?: string;
    }
  }
}

export interface AuthedRequest extends Request {
  cafeId: string;
  userId: string;
  role: string;
}

interface StaffTokenPayload {
  sub: string;
  cafeId: string;
  role: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET not set');
    }
    const payload = jwt.verify(token, secret) as StaffTokenPayload;
    if (!payload || !payload.sub || !payload.cafeId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.userId = payload.sub;
    req.cafeId = payload.cafeId;
    req.role = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
