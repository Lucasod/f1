import { config } from './src/config';
import { MongoPersonRepository } from './src/modules/person/person.mongo.repository';
import { connectToMongo } from './src/shared/database/mongo.client';
import { AuthService } from './src/modules/auth/auth.service';
import jwt from 'jsonwebtoken';

async function test() {
  const db = await connectToMongo();
  const personRepo = new MongoPersonRepository(db);
  const authService = new AuthService(personRepo, config.jwtSecret, config.jwtExpiresIn, '30d');

  const testPassword = process.env.TEST_USER_PASSWORD;
  if (!testPassword) throw new Error('TEST_USER_PASSWORD is required');

  const result = await authService.login({ email: 'testuser2@example.com', password: testPassword });
  console.log('Authentication succeeded');

  try {
    const decoded = jwt.verify(result.tokens.accessToken, config.jwtSecret);
    console.log('Token verified');
  } catch (e) {
    console.log('Self-verify failed:', e.message);
  }
}

test().catch(console.error);
