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
  let otherAccessToken: string;
  let personRepo: InMemoryPersonRepository;

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
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
    const otherConsumer = await authService.register({
      name: 'Other Consumer',
      taxIdType: 'CPF',
      taxIdValue: '11144477735',
      email: 'other@example.com',
      password: 'SecurePass123!',
      role: PersonRole.CONSUMER,
    });
    otherAccessToken = otherConsumer.tokens.accessToken;

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

  it('returns only the authenticated person profile and requires authentication', async () => {
    const ownProfile = await request(app)
      .get('/api/v1/person/me')
      .set('Authorization', ['Bearer', accessToken].join(' '))
      .expect(200);
    const otherProfile = await request(app)
      .get('/api/v1/person/me')
      .set('Authorization', ['Bearer', otherAccessToken].join(' '))
      .expect(200);

    expect(ownProfile.body.person.id).not.toBe(otherProfile.body.person.id);
    expect(ownProfile.body.person.mainInfo.taxIdValue).toBe('*******4725');
    expect(ownProfile.body.person.contactInfos.map((contact: { value: string }) => contact.value))
      .toEqual(['consumer@example.com']);

    await request(app).get('/api/v1/person/me').expect(401);
  });

  it('validates and persists delivery addresses for the authenticated person', async () => {
    await request(app)
      .post('/api/v1/person/me/addresses')
      .set('Authorization', ['Bearer', accessToken].join(' '))
      .send({
        street: 'New Street',
        number: '99',
        neighborhood: 'Centro',
        city: 'Curitiba',
        state: 'XX',
      })
      .expect(400);

    const response = await request(app)
      .post('/api/v1/person/me/addresses')
      .set('Authorization', ['Bearer', accessToken].join(' '))
      .send({
        street: 'New Street',
        number: '99',
        neighborhood: 'Centro',
        city: 'Curitiba',
        state: 'pr',
        isPrimary: false,
      })
      .expect(201);

    expect(response.body.person.addresses).toHaveLength(1);
    expect(response.body.person.addresses[0]).toMatchObject({
      street: 'New Street',
      number: '99',
      city: 'Curitiba',
      state: 'PR',
    });
    const persistedPerson = await personRepo.findById(response.body.person.id);
    expect(persistedPerson?.addresses).toHaveLength(1);

    const otherProfile = await request(app)
      .get('/api/v1/person/me')
      .set('Authorization', ['Bearer', otherAccessToken].join(' '))
      .expect(200);
    expect(otherProfile.body.person.addresses).toEqual([]);
  });

  it('returns a conflict when a contact email belongs to another person', async () => {
    const response = await request(app)
      .post('/api/v1/person/me/contacts')
      .set('Authorization', ['Bearer', accessToken].join(' '))
      .send({ type: 'email', value: 'other@example.com' })
      .expect(409);

    expect(response.body.error).toBe('EMAIL_ALREADY_EXISTS');
    const person = await personRepo.findByEmail('consumer@example.com');
    expect(person?.contactInfos.map(contact => contact.value)).toEqual(['consumer@example.com']);
  });

  it('rejects duplicate emails when replacing or updating contacts without mutating the profile', async () => {
    const profileResponse = await request(app)
      .get('/api/v1/person/me')
      .set('Authorization', ['Bearer', accessToken].join(' '))
      .expect(200);
    const emailContact = profileResponse.body.person.contactInfos[0];

    await request(app)
      .patch('/api/v1/person/me/contacts')
      .set('Authorization', ['Bearer', accessToken].join(' '))
      .send({
        contacts: [{
          id: emailContact.id,
          type: 'email',
          value: 'other@example.com',
          isPrimary: true,
        }],
      })
      .expect(409);

    await request(app)
      .patch(`/api/v1/person/me/contacts/${emailContact.id}`)
      .set('Authorization', ['Bearer', accessToken].join(' '))
      .send({ value: 'other@example.com' })
      .expect(409);

    const person = await personRepo.findByEmail('consumer@example.com');
    expect(person?.contactInfos.map(contact => contact.value)).toEqual(['consumer@example.com']);
  });
});
