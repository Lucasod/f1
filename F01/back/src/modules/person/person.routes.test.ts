import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { InMemoryPersonRepository, PersonRole } from './person.domain';
import { PersonService } from './person.service';
import { createPersonRoutes } from './person.routes';

describe('Person profile routes', () => {
  let app: express.Express;
  let authService: AuthService;
  let accessToken: string;

  beforeEach(async () => {
    const personRepo = new InMemoryPersonRepository();
    authService = new AuthService(personRepo, 'test-secret-key', '24h');
    const { tokens } = await authService.register({
      name: 'Consumer Name',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: 'consumer@example.com',
      password: 'SecurePass123!',
      role: PersonRole.CONSUMER,
    });
    accessToken = tokens.accessToken;

    app = express();
    app.use(express.json());
    app.use('/api/v1/person', createPersonRoutes({
      authService,
      personService: new PersonService(personRepo),
      personRepo,
    }));
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: error.message });
    });
  });

  it('updates the authenticated person name and returns the matching MainInfo name', async () => {
    const response = await request(app)
      .patch('/api/v1/person/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Updated Consumer' });

    expect(response.status).toBe(200);
    expect(response.body.person.name).toBe('Updated Consumer');
    expect(response.body.person.mainInfo.name).toBe('Updated Consumer');
    expect(response.body.person.mainInfo.taxIdValue).not.toBe('52998224725');
  });

  it('rejects a missing name rather than throwing a server error', async () => {
    const response = await request(app)
      .patch('/api/v1/person/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('NAME_REQUIRED');
  });
});
