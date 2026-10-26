import { Request, Response, NextFunction } from 'express';
import { AuthService, JWTPayload } from './auth.service';
import { PersonRole } from '../person/person.domain';

export interface AuthenticatedRequest extends Request {
  user: JWTPayload;
}

export function authMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'MISSING_TOKEN', message: 'Authorization header with Bearer token is required' });
      return;
    }

    const token = authHeader.substring(7);

    try {
      const payload = authService.verifyToken(token);
      
      if (payload.type !== 'access') {
        res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid token type' });
        return;
      }

      (req as AuthenticatedRequest).user = payload;
      next();
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case 'TOKEN_EXPIRED':
            res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Access token has expired' });
            return;
          case 'INVALID_TOKEN':
            res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid access token' });
            return;
        }
      }
      res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid access token' });
    }
  };
}

export function requireRole(...roles: PersonRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = req.user;
    
    if (!user) {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
      return;
    }

    const hasRole = roles.some(role => user.roles.includes(role));
    
    if (!hasRole) {
      res.status(403).json({ 
        error: 'FORBIDDEN', 
        message: `Access denied. Required role(s): ${roles.join(', ')}` 
      });
      return;
    }

    next();
  };
}

export function requireAnyRole(roles: PersonRole[]) {
  return requireRole(...roles);
}

export function requireConsumer() {
  return requireRole(PersonRole.CONSUMER);
}

export function requireVendor() {
  return requireRole(PersonRole.VENDOR);
}

export function requireAdmin() {
  return requireRole(PersonRole.ADMIN);
}