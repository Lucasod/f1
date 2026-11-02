import jwt from 'jsonwebtoken';
import { Person, PersonRole, PersonRepository } from '../person/person.domain';
import { validatePersonTaxId } from '../person/person.domain';
import { hashPassword, verifyPassword, CredentialError } from '../auth/credential.domain';

export enum AuthError {
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  TAX_ID_ALREADY_EXISTS = 'TAX_ID_ALREADY_EXISTS',
  WEAK_PASSWORD = 'WEAK_PASSWORD',
  INVALID_EMAIL = 'INVALID_EMAIL',
  INVALID_TAX_ID = 'INVALID_TAX_ID',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_CURRENT_PASSWORD = 'INVALID_CURRENT_PASSWORD',
  INVALID_TOKEN = 'INVALID_TOKEN',
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

  constructor(repo: PersonRepository, jwtSecret: string, jwtExpiresIn: string, refreshExpiresIn: string = '30d') {
    this.repo = repo;
    this.jwtSecret = jwtSecret;
    this.jwtExpiresIn = jwtExpiresIn;
    this.refreshExpiresIn = refreshExpiresIn;
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
    let hashedPassword: string;
    try {
      hashedPassword = await hashPassword(input.password);
    } catch (error) {
      if (error instanceof Error && Object.values(CredentialError).includes(error.message as CredentialError)) {
        throw new Error(AuthError.WEAK_PASSWORD);
      }
      throw new Error(AuthError.WEAK_PASSWORD);
    }

    // Create person
    const person = Person.create({
      name: input.name,
      mainInfo: { name: input.name, taxIdType: input.taxIdType, taxIdValue: input.taxIdValue },
      contactInfos: [{ type: 'email', value: input.email, isPrimary: true, id: '' }],
      addresses: []
    });

    person.addRole(input.role);
    person.setCredential(hashedPassword);

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
      throw new Error(AuthError.INVALID_CURRENT_PASSWORD);
    }

    let hashedPassword: string;
    try {
      hashedPassword = await hashPassword(newPassword);
    } catch (error) {
      if (error instanceof Error && Object.values(CredentialError).includes(error.message as CredentialError)) {
        throw new Error(AuthError.WEAK_PASSWORD);
      }
      throw error;
    }

    person.replaceCredential(hashedPassword);
    await this.repo.update(person);
  }

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    let payload: JWTPayload;

    try {
      payload = jwt.verify(refreshToken, this.jwtSecret) as JWTPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error(AuthError.TOKEN_EXPIRED);
      }
      throw new Error(AuthError.INVALID_TOKEN);
    }

    if (payload.type !== 'refresh') {
      throw new Error(AuthError.INVALID_TOKEN);
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
      throw new Error(AuthError.INVALID_TOKEN);
    }
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