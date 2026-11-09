import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { Person, PersonRole, PersonRepository } from '../person/person.domain';
import { validatePersonTaxId } from '../person/person.domain';
import { hashPassword, verifyPassword, CredentialError } from '../auth/credential.domain';
import { config } from '../../config';

const DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function parseExpiresInToSeconds(expiresIn: string): number {
  const raw = String(expiresIn).trim();
  if (raw === '') return DEFAULT_REFRESH_TTL_SECONDS;
  const numeric = Number(raw);
  if (!Number.isNaN(numeric)) return Math.floor(numeric);
  const match = raw.match(/^(\d+)(d|h|m|s)$/);
  if (!match) return DEFAULT_REFRESH_TTL_SECONDS;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd':
      return value * 86400;
    case 'h':
      return value * 3600;
    case 'm':
      return value * 60;
    default:
      return value;
  }
}

export enum AuthError {
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  TAX_ID_ALREADY_EXISTS = 'TAX_ID_ALREADY_EXISTS',
  CREDENTIAL_TOO_WEAK = 'WEAK_PASSWORD',
  INVALID_EMAIL = 'INVALID_EMAIL',
  INVALID_TAX_ID = 'INVALID_TAX_ID',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_CURRENT_CREDENTIAL = 'INVALID_CURRENT_PASSWORD',
  INVALID_SESSION = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  PERSON_NOT_FOUND = 'PERSON_NOT_FOUND'
}

export interface RegisterInput {
  name: string;
  taxIdType: 'CPF' | 'CNPJ';
  taxIdValue: string;
  email: string;
  password: string;
  role: PersonRole;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterResult {
  person: Person;
  tokens: TokenPair;
}

export interface LoginResult {
  person: Person;
  tokens: TokenPair;
}

export interface JWTPayload {
  sub: string;
  email: string;
  roles: PersonRole[];
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export interface RefreshTokenResult {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  private readonly repo: PersonRepository;
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly refreshExpiresIn: string;
  private readonly refreshTtlSeconds: number;
  private readonly redis: Redis;
  // Redis is the durable, shared revocation store. The in-memory set below is a
  // graceful-degradation fallback: revoked tokens are mirrored here so logout and
  // refresh keep working when Redis is temporarily unreachable (e.g. Redis not
  // configured, wrong port, or network failure).
  private readonly revokedTokens = new Set<string>();
  private readonly keyPrefix = 'revoked_token:';

  constructor(
    repo: PersonRepository,
    jwtSecret: string,
    jwtExpiresIn: string,
    refreshExpiresIn: string = '30d',
    redisClient?: Redis
  ) {
    this.repo = repo;
    this.jwtSecret = jwtSecret;
    this.jwtExpiresIn = jwtExpiresIn;
    this.refreshExpiresIn = refreshExpiresIn;
    this.refreshTtlSeconds = parseExpiresInToSeconds(refreshExpiresIn);
    this.redis =
      redisClient ||
      new Redis(config.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
    // Connection errors are swallowed here and handled per-operation so auth
    // keeps working when Redis is unreachable instead of crashing the process.
    this.redis.on('error', () => {
      // Intentionally empty: Redis errors are handled per call.
    });
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    // Validate email format
    if (!this.isValidEmail(input.email)) {
      throw new Error(AuthError.INVALID_EMAIL);
    }

    // Validate tax ID
    const taxIdResult = validatePersonTaxId(
      input.taxIdType === 'CPF' ? input.taxIdValue : undefined,
      input.taxIdType === 'CNPJ' ? input.taxIdValue : undefined
    );

    if (!taxIdResult.isValid) {
      throw new Error(AuthError.INVALID_TAX_ID);
    }

    // Check if email already exists
    const existingByEmail = await this.repo.findByEmail(input.email);
    if (existingByEmail) {
      throw new Error(AuthError.EMAIL_ALREADY_EXISTS);
    }

    // Check if tax ID already exists
    const existingByTaxId = await this.repo.findByTaxId(input.taxIdType, input.taxIdValue);
    if (existingByTaxId) {
      throw new Error(AuthError.TAX_ID_ALREADY_EXISTS);
    }

    // Hash password (validates strength internally)
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(input.password);
    } catch (error) {
      if (error instanceof Error && Object.values(CredentialError).includes(error.message as CredentialError)) {
        throw new Error(AuthError.CREDENTIAL_TOO_WEAK);
      }
      throw new Error(AuthError.CREDENTIAL_TOO_WEAK);
    }

    // Create person
    const person = Person.create({
      name: input.name,
      mainInfo: { name: input.name, taxIdType: input.taxIdType, taxIdValue: input.taxIdValue },
      contactInfos: [{ type: 'email', value: input.email, isPrimary: true, id: '' }],
      addresses: []
    });

    person.addRole(input.role);
    person.setCredential(passwordHash);

    // Save person
    await this.repo.save(person);

    // Generate tokens
    const tokens = this.generateTokens(person);

    return { person, tokens };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    if (!input.email || !input.password) {
      throw new Error(AuthError.INVALID_CREDENTIALS);
    }

    const person = await this.repo.findByEmail(input.email);
    if (!person) {
      throw new Error(AuthError.INVALID_CREDENTIALS);
    }

    if (!person.credential) {
      throw new Error(AuthError.INVALID_CREDENTIALS);
    }

    const isValid = await verifyPassword(input.password, person.credential);
    if (!isValid) {
      throw new Error(AuthError.INVALID_CREDENTIALS);
    }

    const tokens = this.generateTokens(person);

    return { person, tokens };
  }

  async changePassword(personId: string, currentPassword: string, newPassword: string): Promise<void> {
    const person = await this.repo.findById(personId);
    if (!person) {
      throw new Error(AuthError.PERSON_NOT_FOUND);
    }

    if (!person.credential || !(await verifyPassword(currentPassword, person.credential))) {
      throw new Error(AuthError.INVALID_CURRENT_CREDENTIAL);
    }

    let passwordHash: string;
    try {
      passwordHash = await hashPassword(newPassword);
    } catch (error) {
      if (error instanceof Error && Object.values(CredentialError).includes(error.message as CredentialError)) {
        throw new Error(AuthError.CREDENTIAL_TOO_WEAK);
      }
      throw error;
    }

    person.replaceCredential(passwordHash);
    await this.repo.update(person);
  }

  async logout(refreshToken: string): Promise<void> {
    let payload: JWTPayload;

    try {
      payload = jwt.verify(refreshToken, this.jwtSecret) as JWTPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error(AuthError.TOKEN_EXPIRED);
      }
      throw new Error(AuthError.INVALID_SESSION);
    }

    if (payload.type !== 'refresh') {
      throw new Error(AuthError.INVALID_SESSION);
    }

    const person = await this.repo.findById(payload.sub);
    if (!person) {
      throw new Error(AuthError.PERSON_NOT_FOUND);
    }

    await this.revokeToken(refreshToken);
  }

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    if (await this.isTokenRevoked(refreshToken)) {
      throw new Error(AuthError.INVALID_SESSION);
    }

    let payload: JWTPayload;

    try {
      payload = jwt.verify(refreshToken, this.jwtSecret) as JWTPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error(AuthError.TOKEN_EXPIRED);
      }
      throw new Error(AuthError.INVALID_SESSION);
    }

    if (payload.type !== 'refresh') {
      throw new Error(AuthError.INVALID_SESSION);
    }

    const person = await this.repo.findById(payload.sub);
    if (!person) {
      throw new Error(AuthError.PERSON_NOT_FOUND);
    }

    return this.generateTokens(person);
  }

  verifyToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as JWTPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error(AuthError.TOKEN_EXPIRED);
      }
      throw new Error(AuthError.INVALID_SESSION);
    }
  }

  /**
   * Returns true when the token has been revoked (logout). Redis is the durable,
   * shared source of truth; the in-memory set is a graceful-degradation fallback
   * used when Redis is unreachable.
   */
  private async isTokenRevoked(token: string): Promise<boolean> {
    const key = this.getRevocationKey(token);

    try {
      const value = await this.redis.get(key);
      if (value === '1') {
        this.revokedTokens.add(token);
        return true;
      }
    } catch {
      // Redis unavailable: fall back to the in-memory set below.
    }

    return this.revokedTokens.has(token);
  }

  /**
   * Revokes a refresh token in Redis with a TTL matching the refresh token
   * expiry, and mirrors it into the in-memory fallback set.
   */
  private async revokeToken(token: string): Promise<void> {
    const key = this.getRevocationKey(token);

    try {
      await this.redis.set(key, '1', 'EX', this.refreshTtlSeconds);
    } catch {
      // Redis unavailable: rely on the in-memory fallback below.
    }

    this.revokedTokens.add(token);
  }

  private getRevocationKey(token: string): string {
    return `${this.keyPrefix}${createHash('sha256').update(token).digest('hex')}`;
  }

  private generateTokens(person: Person): TokenPair {
    const accessPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      sub: person.id,
      email: person.email || '',
      roles: person.roles,
      type: 'access'
    };

    const refreshPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      sub: person.id,
      email: person.email || '',
      roles: person.roles,
      type: 'refresh'
    };

    const accessToken = jwt.sign(accessPayload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn as jwt.SignOptions['expiresIn']
    });

    const refreshToken = jwt.sign(refreshPayload, this.jwtSecret, {
      expiresIn: this.refreshExpiresIn as jwt.SignOptions['expiresIn']
    });

    return { accessToken, refreshToken };
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}