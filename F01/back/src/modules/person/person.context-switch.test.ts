import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  InMemoryPersonRepository,
  Person,
  PersonRole,
} from './person.domain';
import { PersonService } from './person.service';
import { InMemoryVendorRepository } from '../vendor/vendor.domain';
import { AuthService } from '../auth/auth.service';
import { VendorService } from '../vendor/vendor.service';
import { createPersonRoutes } from './person.routes';
import { createAuthRoutes } from '../auth/auth.routes';
import { createVendorRoutes } from '../vendor/vendor.routes';
import { config } from '../../config';

const VALID_CPF = '52998224725';
const VALID_CPF_2 = '98765432100';
const testPassword = process.env.TEST_USER_PASSWORD!;

describe('Person context switching (Consumer <-> Vendor)', () => {
  let app: express.Express;
  let personRepo: InMemoryPersonRepository;
  let vendorRepo: InMemoryVendorRepository;
  let authService: AuthService;
  let vendorService: VendorService;
  let personService: PersonService;
  let accessToken: string;
  let personId: string;

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
    vendorRepo = new InMemoryVendorRepository();
    authService = new AuthService(personRepo, 'test-secret-key', '24h', '30d');
    vendorService = new VendorService(vendorRepo, personRepo, config);
    personService = new PersonService(personRepo);

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRoutes({ authService }));
    app.use('/api/v1/person', createPersonRoutes({
      authService,
      personService,
      personRepo,
    }));
    app.use('/api/v1/vendor', createVendorRoutes({
      authService,
      vendorService,
      personRepo,
    }));

    // Register as Consumer (LC-04: cadastro começando como comprador)
    const register = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Dual Role User',
        taxIdType: 'CPF',
        taxIdValue: VALID_CPF,
        email: 'dual@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER,
      });
    expect(register.status).toBe(201);
    expect(register.body.person.roles).toEqual([PersonRole.CONSUMER]);
    personId = register.body.person.id;
    accessToken = register.body.tokens.accessToken;
  });

  it('registers a consumer with only CONSUMER role (LC-04)', async () => {
    const person = await personRepo.findById(personId);
    expect(person?.roles).toEqual([PersonRole.CONSUMER]);
    expect(person?.credential).toBeDefined();
  });

  it('rejects direct registration as Admin (LC-04: Admin incompatível com compra/venda)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Admin User',
        taxIdType: 'CPF',
        taxIdValue: VALID_CPF_2,
        email: 'admin2@example.com',
        password: testPassword,
        role: PersonRole.ADMIN,
      });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN_ROLE');
  });

  it('onboards the consumer as Vendor, both roles coexist on same Person (LC-04)', async () => {
    const onboard = await request(app)
      .post('/api/v1/vendor/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storeName: 'Dual Store', slug: 'dual-store' });
    expect(onboard.status).toBe(201);

    const person = await personRepo.findById(personId);
    expect(person?.roles).toEqual([PersonRole.CONSUMER, PersonRole.VENDOR]);
    expect(person?.credential).toBeDefined(); // same identity & credential preserved
  });

  it('re-login issues a token carrying both roles (LC-05: sessão preservada + atualização)', async () => {
    await request(app)
      .post('/api/v1/vendor/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storeName: 'Dual Store', slug: 'dual-store' });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'dual@example.com', password: testPassword });
    expect(login.status).toBe(200);

    const payload = authService.verifyToken(login.body.tokens.accessToken);
    expect(payload.roles).toContain(PersonRole.CONSUMER);
    expect(payload.roles).toContain(PersonRole.VENDOR);
  });

  it('accesses consumer profile (person/me) after becoming Vendor (LC-05: Consumer contexto)', async () => {
    await request(app)
      .post('/api/v1/vendor/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storeName: 'Dual Store', slug: 'dual-store' });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'dual@example.com', password: testPassword });
    const dualToken = login.body.tokens.accessToken;

    const profile = await request(app)
      .get('/api/v1/person/me')
      .set('Authorization', `Bearer ${dualToken}`);
    expect(profile.status).toBe(200);
    expect(profile.body.person.roles).toContain(PersonRole.CONSUMER);
    expect(profile.body.person.roles).toContain(PersonRole.VENDOR);
  });

  it('accesses vendor profile (vendor/me) with the same session (LC-05: Vendor contexto)', async () => {
    await request(app)
      .post('/api/v1/vendor/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storeName: 'Dual Store', slug: 'dual-store' });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'dual@example.com', password: testPassword });
    const dualToken = login.body.tokens.accessToken;

    const vendor = await request(app)
      .get('/api/v1/vendor/me')
      .set('Authorization', `Bearer ${dualToken}`);
    expect(vendor.status).toBe(200);
    expect(vendor.body.vendor.storeName).toBe('Dual Store');
    expect(vendor.body.vendor.personId).toBe(personId);
  });

  it('keeps the same session/identity across both contexts (LC-05: sessão preservada na troca)', async () => {
    await request(app)
      .post('/api/v1/vendor/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storeName: 'Dual Store', slug: 'dual-store' });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'dual@example.com', password: testPassword });
    const dualToken = login.body.tokens.accessToken;

    const profile = await request(app)
      .get('/api/v1/person/me')
      .set('Authorization', `Bearer ${dualToken}`);
    const vendor = await request(app)
      .get('/api/v1/vendor/me')
      .set('Authorization', `Bearer ${dualToken}`);

    expect(profile.status).toBe(200);
    expect(vendor.status).toBe(200);
    expect(profile.body.person.id).toBe(personId);
    expect(vendor.body.vendor.personId).toBe(personId);
  });

  it('denies vendor context to a Consumer-only user (isolamento / sem acesso indevido)', async () => {
    const consumer = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Consumer Only',
        taxIdType: 'CPF',
        taxIdValue: VALID_CPF_2,
        email: 'consumer-only@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER,
      });
    const consumerToken = consumer.body.tokens.accessToken;

    const vendor = await request(app)
      .get('/api/v1/vendor/me')
      .set('Authorization', `Bearer ${consumerToken}`);
    expect(vendor.status).toBe(404); // no vendor profile for consumer-only user
  });
});
