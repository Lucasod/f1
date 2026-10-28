import { Router, Request, Response, NextFunction } from 'express';
import { AuthService, AuthError, RegisterInput, LoginInput } from './auth.service';
import { PersonRepository } from '../person/person.domain';
import { PersonRole } from '../person/person.domain';

export interface AuthRoutesConfig {
  authService: AuthService;
}

export function createAuthRoutes({ authService }: AuthRoutesConfig): Router {
  const router = Router();

  // POST /api/v1/auth/register
  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, taxIdType, taxIdValue, email, password, role } = req.body as RegisterInput;

      if (!name || !taxIdType || !taxIdValue || !email || !password) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: 'All fields are required' });
      }

      let determinedRole: PersonRole = PersonRole.CONSUMER;

      if (role) {
        if (!Object.values(PersonRole).includes(role)) {
          return res.status(400).json({ error: 'INVALID_ROLE', message: 'Invalid role' });
        }

        if (role === PersonRole.ADMIN) {
          return res.status(403).json({ error: 'FORBIDDEN_ROLE', message: 'Admin cannot be created via public registration' });
        }

        if (role === PersonRole.VENDOR) {
          determinedRole = PersonRole.CONSUMER;
        } else if (role === PersonRole.CONSUMER) {
          determinedRole = PersonRole.CONSUMER;
        }
      }

      const result = await authService.register({ name, taxIdType, taxIdValue, email, password, role: determinedRole });

      return res.status(201).json({
        person: {
          id: result.person.id,
          name: result.person.name,
          email: result.person.email,
          roles: result.person.roles,
          createdAt: result.person.createdAt
        },
        tokens: result.tokens
      });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case AuthError.EMAIL_ALREADY_EXISTS:
            return res.status(409).json({ error: AuthError.EMAIL_ALREADY_EXISTS, message: 'Email already registered' });
          case AuthError.TAX_ID_ALREADY_EXISTS:
            return res.status(409).json({ error: AuthError.TAX_ID_ALREADY_EXISTS, message: 'Tax ID already registered' });
          case AuthError.WEAK_PASSWORD:
            return res.status(400).json({ error: AuthError.WEAK_PASSWORD, message: 'Password does not meet requirements' });
          case AuthError.INVALID_EMAIL:
            return res.status(400).json({ error: AuthError.INVALID_EMAIL, message: 'Invalid email format' });
          case AuthError.INVALID_TAX_ID:
            return res.status(400).json({ error: AuthError.INVALID_TAX_ID, message: 'Invalid CPF/CNPJ' });
        }
      }
      next(error);
    }
  });

  // POST /api/v1/auth/login
  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body as LoginInput;

      if (!email || !password) {
        return res.status(400).json({ error: 'MISSING_CREDENTIALS', message: 'Email and password are required' });
      }

      const result = await authService.login({ email, password });

      return res.json({
        person: {
          id: result.person.id,
          name: result.person.name,
          email: result.person.email,
          roles: result.person.roles
        },
        tokens: result.tokens
      });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case AuthError.INVALID_CREDENTIALS:
            return res.status(401).json({ error: AuthError.INVALID_CREDENTIALS, message: 'Invalid email or password' });
        }
      }
      next(error);
    }
  });

  // POST /api/v1/auth/refresh
  router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({ error: 'MISSING_REFRESH_TOKEN', message: 'Refresh token is required' });
      }

      const tokens = await authService.refreshToken(refreshToken);

      return res.json({ tokens });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case AuthError.INVALID_TOKEN:
            return res.status(401).json({ error: AuthError.INVALID_TOKEN, message: 'Invalid refresh token' });
          case AuthError.TOKEN_EXPIRED:
            return res.status(401).json({ error: AuthError.TOKEN_EXPIRED, message: 'Refresh token expired' });
          case AuthError.PERSON_NOT_FOUND:
            return res.status(401).json({ error: AuthError.PERSON_NOT_FOUND, message: 'User not found' });
        }
      }
      next(error);
    }
  });

  return router;
}