export enum PersonTaxIdError {
  BOTH_PROVIDED = 'BOTH_PROVIDED',
  NEITHER_PROVIDED = 'NEITHER_PROVIDED',
  INVALID_CPF_LENGTH = 'INVALID_CPF_LENGTH',
  INVALID_CNPJ_LENGTH = 'INVALID_CNPJ_LENGTH',
  INVALID_CPF_FORMAT = 'INVALID_CPF_FORMAT',
  INVALID_CNPJ_FORMAT = 'INVALID_CNPJ_FORMAT',
  INVALID_CPF_CHECK_DIGITS = 'INVALID_CPF_CHECK_DIGITS',
  INVALID_CNPJ_CHECK_DIGITS = 'INVALID_CNPJ_CHECK_DIGITS',
  ALL_DIGITS_SAME = 'ALL_DIGITS_SAME'
}

export interface PersonTaxIdResult {
  isValid: boolean;
  type?: 'CPF' | 'CNPJ';
  value?: string;
  error?: PersonTaxIdError;
}

export enum PersonRole {
  CONSUMER = 'CONSUMER',
  VENDOR = 'VENDOR',
  ADMIN = 'ADMIN'
}

export interface ContactInfo {
  type: 'email' | 'phone' | 'whatsapp';
  value: string;
  isPrimary: boolean;
}

export interface Address {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  isPrimary?: boolean;
}

export interface MainInfo {
  name: string;
  taxIdType: 'CPF' | 'CNPJ';
  taxIdValue: string;
}

export interface PersonData {
  id?: string;
  name: string;
  mainInfo: MainInfo;
  contactInfos: ContactInfo[];
  addresses: Address[];
  roles?: PersonRole[];
  credential?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export class Person {
  public readonly id: string;
  public readonly name: string;
  public readonly mainInfo: MainInfo;
  public readonly contactInfos: ContactInfo[];
  public readonly addresses: Address[];
  public readonly roles: PersonRole[];
  public readonly credential: string | null;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private constructor(data: PersonData) {
    this.id = data.id || generateId();
    this.name = data.name;
    this.mainInfo = data.mainInfo;
    this.contactInfos = data.contactInfos;
    this.addresses = data.addresses;
    this.roles = data.roles || [];
    this.credential = data.credential || null;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  static create(data: Omit<PersonData, 'id' | 'createdAt' | 'updatedAt' | 'roles' | 'credential'>): Person {
    if (!data.name || data.name.trim().length === 0) {
      throw new Error('NAME_REQUIRED');
    }

    if (!data.mainInfo.taxIdValue || data.mainInfo.taxIdValue.trim().length === 0) {
      throw new Error('TAX_ID_REQUIRED');
    }

    const hasEmail = data.contactInfos.some(c => c.type === 'email');
    if (!hasEmail) {
      throw new Error('EMAIL_REQUIRED');
    }

    for (const contact of data.contactInfos) {
      if (contact.type === 'email' && !validateEmail(contact.value)) {
        throw new Error('INVALID_EMAIL_FORMAT');
      }
    }

    return new Person({
      ...data,
      roles: [],
      credential: null
    });
  }

  addRole(role: PersonRole): void {
    if (this.roles.includes(role)) {
      return;
    }

    if (role === PersonRole.ADMIN && (this.roles.includes(PersonRole.CONSUMER) || this.roles.includes(PersonRole.VENDOR))) {
      throw new Error('ADMIN_EXCLUSIVE');
    }

    if ((role === PersonRole.CONSUMER || role === PersonRole.VENDOR) && this.roles.includes(PersonRole.ADMIN)) {
      throw new Error('ADMIN_EXCLUSIVE');
    }

    this.roles.push(role);
  }

  setCredential(hashedPassword: string): void {
    if (this.credential !== null) {
      throw new Error('CREDENTIAL_ALREADY_SET');
    }
    (this as any).credential = hashedPassword;
  }

  get email(): string | null {
    const emailContact = this.contactInfos.find(c => c.type === 'email');
    return emailContact ? emailContact.value : null;
  }

  get primaryEmail(): string | null {
    const primaryEmailContact = this.contactInfos.find(c => c.type === 'email' && c.isPrimary);
    return primaryEmailContact ? primaryEmailContact.value : this.email;
  }
}

export interface PersonRepository {
  save(person: Person): Promise<Person>;
  findById(id: string): Promise<Person | null>;
  findByEmail(email: string): Promise<Person | null>;
  findByTaxId(type: 'CPF' | 'CNPJ', value: string): Promise<Person | null>;
  delete(id: string): Promise<void>;
}

function normalizeTaxId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function allDigitsSame(value: string): boolean {
  return value.split('').every(d => d === value[0]);
}

function calculateCheckDigit(digits: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += digits[i] * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function validateCpfCheckDigits(cpf: string): boolean {
  const digits = cpf.split('').map(Number);
  const weights1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

  const check1 = calculateCheckDigit(digits, weights1);
  if (check1 !== digits[9]) return false;

  const check2 = calculateCheckDigit(digits, weights2);
  return check2 === digits[10];
}

function validateCnpjCheckDigits(cnpj: string): boolean {
  const digits = cnpj.split('').map(Number);
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const check1 = calculateCheckDigit(digits, weights1);
  if (check1 !== digits[12]) return false;

  const check2 = calculateCheckDigit(digits, weights2);
  return check2 === digits[13];
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

export function validatePersonTaxId(cpf: string | null | undefined, cnpj: string | null | undefined): PersonTaxIdResult {
  const safeCpf = normalizeTaxId(cpf);
  const safeCnpj = normalizeTaxId(cnpj);

  if (safeCpf && safeCnpj) {
    return { isValid: false, error: PersonTaxIdError.BOTH_PROVIDED };
  }

  if (safeCpf) {
    if (safeCpf.length !== 11) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_LENGTH };
    }
    if (!isNumeric(safeCpf)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_FORMAT };
    }
    if (allDigitsSame(safeCpf)) {
      return { isValid: false, error: PersonTaxIdError.ALL_DIGITS_SAME };
    }
    if (!validateCpfCheckDigits(safeCpf)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_CHECK_DIGITS };
    }
    return { isValid: true, type: 'CPF', value: safeCpf };
  }

  if (safeCnpj) {
    if (safeCnpj.length !== 14) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_LENGTH };
    }
    if (!isNumeric(safeCnpj)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_FORMAT };
    }
    if (allDigitsSame(safeCnpj)) {
      return { isValid: false, error: PersonTaxIdError.ALL_DIGITS_SAME };
    }
    if (!validateCnpjCheckDigits(safeCnpj)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_CHECK_DIGITS };
    }
    return { isValid: true, type: 'CNPJ', value: safeCnpj };
  }

  return { isValid: false, error: PersonTaxIdError.NEITHER_PROVIDED };
}

export class InMemoryPersonRepository implements PersonRepository {
  private persons: Map<string, Person> = new Map();
  private emailIndex: Map<string, string> = new Map();

  async save(person: Person): Promise<Person> {
    for (const contact of person.contactInfos) {
      if (contact.type === 'email') {
        const existingId = this.emailIndex.get(contact.value.toLowerCase());
        if (existingId && existingId !== person.id) {
          throw new Error('EMAIL_ALREADY_EXISTS');
        }
        this.emailIndex.set(contact.value.toLowerCase(), person.id);
      }
    }
    this.persons.set(person.id, person);
    return person;
  }

  async findById(id: string): Promise<Person | null> {
    return this.persons.get(id) || null;
  }

  async findByEmail(email: string): Promise<Person | null> {
    const personId = this.emailIndex.get(email.toLowerCase());
    if (!personId) return null;
    return this.persons.get(personId) || null;
  }

  async findByTaxId(type: 'CPF' | 'CNPJ', value: string): Promise<Person | null> {
    for (const person of this.persons.values()) {
      if (person.mainInfo.taxIdType === type && person.mainInfo.taxIdValue === value) {
        return person;
      }
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    const person = this.persons.get(id);
    if (person) {
      for (const contact of person.contactInfos) {
        if (contact.type === 'email') {
          this.emailIndex.delete(contact.value.toLowerCase());
        }
      }
      this.persons.delete(id);
    }
  }

  clear(): void {
    this.persons.clear();
    this.emailIndex.clear();
  }
}