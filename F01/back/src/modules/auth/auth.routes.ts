import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService, AuthError, RegisterInput, LoginInput } from './auth.service';
import { PersonRole } from '../person/person.domain';
import { authMiddleware, AuthenticatedRequest } from './auth.middleware';

export interface AuthRoutesConfig {
  authService: AuthService;
}

export function createAuthRoutes({ authService }: AuthRoutesConfig): Router {
  const router = Router();
  const authMw = authMiddleware(authService);

  // POST /api/v1/auth/register
  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, taxIdType, taxIdValue, email, password, role } = req.body as RegisterInput;

      if (!name || !taxIdType || !taxIdValue || !email || !password) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: 'All fields are required' });
      }

      let determinedRole: PersonRole = PersonRole.CONSUMER;
      const requestedVendorRole = role === PersonRole.VENDOR;

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

      // If VENDOR role was requested, add it to the person (dual-role: CONSUMER + VENDOR)
      if (requestedVendorRole) {
        await authService.addRoleToPerson(result.person.id, PersonRole.VENDOR);
      }

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
          case AuthError.CREDENTIAL_TOO_WEAK:
            return res.status(400).json({ error: AuthError.CREDENTIAL_TOO_WEAK, message: 'Password does not meet requirements' });
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
          case AuthError.INVALID_SESSION:
            return res.status(401).json({ error: AuthError.INVALID_SESSION, message: 'Invalid refresh token' });
          case AuthError.TOKEN_EXPIRED:
            return res.status(401).json({ error: AuthError.TOKEN_EXPIRED, message: 'Refresh token expired' });
          case AuthError.PERSON_NOT_FOUND:
            return res.status(401).json({ error: AuthError.PERSON_NOT_FOUND, message: 'User not found' });
        }
      }
      next(error);
    }
  });

  // PATCH /api/v1/auth/change-password
  router.patch('/change-password', authMw as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return res.status(400).json({ error: 'PASSWORDS_REQUIRED', message: 'Current and new passwords are required' });
      }

      await authService.changePassword(req.user.sub, currentPassword, newPassword);
      return res.json({ message: 'PASSWORD_CHANGED' });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case AuthError.INVALID_CURRENT_CREDENTIAL:
            return res.status(400).json({ error: AuthError.INVALID_CURRENT_CREDENTIAL, message: 'Current password is incorrect' });
          case AuthError.CREDENTIAL_TOO_WEAK:
            return res.status(400).json({ error: AuthError.CREDENTIAL_TOO_WEAK, message: 'New password does not meet requirements' });
          case AuthError.PERSON_NOT_FOUND:
            return res.status(404).json({ error: AuthError.PERSON_NOT_FOUND, message: 'User not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /api/v1/auth/logout
  router.post('/logout', authMw as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };

      if (!refreshToken) {
        return res.status(400).json({ error: 'MISSING_REFRESH_TOKEN', message: 'Refresh token is required' });
      }

      await authService.logout(refreshToken);
      return res.json({ message: 'LOGGED_OUT' });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case AuthError.INVALID_SESSION:
            return res.status(401).json({ error: AuthError.INVALID_SESSION, message: 'Invalid refresh token' });
          case AuthError.TOKEN_EXPIRED:
            return res.status(401).json({ error: AuthError.TOKEN_EXPIRED, message: 'Refresh token expired' });
          case AuthError.PERSON_NOT_FOUND:
            return res.status(404).json({ error: AuthError.PERSON_NOT_FOUND, message: 'User not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}