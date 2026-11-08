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

export enum PersonError {
  PERSON_NOT_FOUND = 'PERSON_NOT_FOUND',
  NAME_REQUIRED = 'NAME_REQUIRED',
  EMAIL_REQUIRED = 'EMAIL_REQUIRED',
  INVALID_EMAIL_FORMAT = 'INVALID_EMAIL_FORMAT',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  ADDRESS_NOT_FOUND = 'ADDRESS_NOT_FOUND',
  CONTACT_NOT_FOUND = 'CONTACT_NOT_FOUND',
  TAX_ID_IMMUTABLE = 'TAX_ID_IMMUTABLE'
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

export enum PermissionLevel {
  READ = 'read',
  READ_WRITE = 'read-write'
}

export interface ContactInfo {
  id: string;
  type: 'email' | 'phone' | 'whatsapp';
  value: string;
  isPrimary: boolean;
}

export interface Address {
  id: string;
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
  permissionLevel?: PermissionLevel;
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
  public permissionLevel?: PermissionLevel;
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
    this.permissionLevel = data.permissionLevel ?? PermissionLevel.READ;
    this.credential = data.credential || null;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  static create(data: Omit<PersonData, 'id' | 'createdAt' | 'updatedAt' | 'roles' | 'credential' | 'contactInfos'> & {
    contactInfos: Array<Omit<ContactInfo, 'id'> & { id?: string }>;
  }): Person {
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

    // Generate IDs for contacts that don't have them
    const contactsWithIds: ContactInfo[] = data.contactInfos.map(c => ({
      ...c,
      id: c.id || generateId()
    }));

    return new Person({
      ...data,
      contactInfos: contactsWithIds,
      roles: [],
      credential: null
    });
  }

  /**
   * Reconstructs a Person from persisted data without validation.
   * Used by repositories when loading from database.
   */
  static reconstruct(data: PersonData): Person {
    return new Person(data);
  }

  addRole(role: PersonRole, permissionLevel?: PermissionLevel): void {
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

    // Update permissionLevel based on role and provided permissionLevel
    if (role === PersonRole.ADMIN) {
      if (permissionLevel !== undefined) {
        this.permissionLevel = permissionLevel;
      } else if (this.permissionLevel === undefined) {
        this.permissionLevel = PermissionLevel.READ;
      }
    }
    // For CONSUMER/VENDOR roles, permissionLevel remains unchanged per CD-059
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

  updateName(newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length === 0) {
      throw new Error(PersonError.NAME_REQUIRED);
    }
    (this as any).name = trimmed;
    (this as any).mainInfo = { ...this.mainInfo, name: trimmed };
    (this as any).updatedAt = new Date();
  }

  replaceCredential(hashedPassword: string): void {
    if (!hashedPassword) {
      throw new Error('CREDENTIAL_REQUIRED');
    }
    (this as any).credential = hashedPassword;
    (this as any).updatedAt = new Date();
  }

  updateContactInfos(contacts: ContactInfo[]): void {
    if (!contacts || contacts.length === 0) {
      throw new Error(PersonError.EMAIL_REQUIRED);
    }
    const hasEmail = contacts.some(c => c.type === 'email');
    if (!hasEmail) {
      throw new Error(PersonError.EMAIL_REQUIRED);
    }
    for (const contact of contacts) {
      if (contact.type === 'email' && !validateEmail(contact.value)) {
        throw new Error(PersonError.INVALID_EMAIL_FORMAT);
      }
    }
    // Ensure all contacts have IDs (generate if missing for backward compatibility)
    const contactsWithIds = contacts.map(c => (c.id ? c : { ...c, id: generateId() }));
    (this as any).contactInfos = contactsWithIds;
    (this as any).updatedAt = new Date();
  }

  updateAddresses(addresses: Address[]): void {
    (this as any).addresses = addresses || [];
    (this as any).updatedAt = new Date();
  }

  addAddress(address: Omit<Address, 'id'>): Address {
    const newAddress: Address = {
      ...address,
      id: generateId()
    };
    (this as any).addresses = [...this.addresses, newAddress];
    (this as any).updatedAt = new Date();
    return newAddress;
  }

  removeAddress(addressId: string): void {
    const index = this.addresses.findIndex(a => a.id === addressId);
    if (index === -1) {
      throw new Error(PersonError.ADDRESS_NOT_FOUND);
    }
    const newAddresses = [...this.addresses];
    newAddresses.splice(index, 1);
    (this as any).addresses = newAddresses;
    (this as any).updatedAt = new Date();
  }

  updateAddress(addressId: string, updates: Partial<Address>): void {
    const index = this.addresses.findIndex(a => a.id === addressId);
    if (index === -1) {
      throw new Error(PersonError.ADDRESS_NOT_FOUND);
    }
    const updatedAddress = { ...this.addresses[index], ...updates };
    // Ensure id is not changed
    updatedAddress.id = addressId;
    const newAddresses = [...this.addresses];
    newAddresses[index] = updatedAddress;
    (this as any).addresses = newAddresses;
    (this as any).updatedAt = new Date();
  }

  addContact(contact: Omit<ContactInfo, 'id'>): void {
    if (contact.type === 'email' && !validateEmail(contact.value)) {
      throw new Error(PersonError.INVALID_EMAIL_FORMAT);
    }
    const newContact: ContactInfo = { ...contact, id: generateId() };
    (this as any).contactInfos = [...this.contactInfos, newContact];
    (this as any).updatedAt = new Date();
  }

  removeContact(contactId: string): void {
    const index = this.contactInfos.findIndex(c => c.id === contactId);
    if (index === -1) {
      throw new Error(PersonError.CONTACT_NOT_FOUND);
    }
    const newContacts = [...this.contactInfos];
    newContacts.splice(index, 1);
    
    // Validate at least one email remains
    const hasEmail = newContacts.some(c => c.type === 'email');
    if (!hasEmail) {
      throw new Error(PersonError.EMAIL_REQUIRED);
    }
    
    (this as any).contactInfos = newContacts;
    (this as any).updatedAt = new Date();
  }

  updateContact(contactId: string, updates: Partial<ContactInfo>): void {
    const index = this.contactInfos.findIndex(c => c.id === contactId);
    if (index === -1) {
      throw new Error(PersonError.CONTACT_NOT_FOUND);
    }
    const updatedContact = { ...this.contactInfos[index], ...updates };
    // Ensure id is not changed
    updatedContact.id = contactId;
    // Validate email format if updating email
    if (updatedContact.type === 'email' && !validateEmail(updatedContact.value)) {
      throw new Error(PersonError.INVALID_EMAIL_FORMAT);
    }
    const newContacts = [...this.contactInfos];
    newContacts[index] = updatedContact;
    
    // Validate at least one email remains
    const hasEmail = newContacts.some(c => c.type === 'email');
    if (!hasEmail) {
      throw new Error(PersonError.EMAIL_REQUIRED);
    }
    
    (this as any).contactInfos = newContacts;
    (this as any).updatedAt = new Date();
  }
}

export interface PersonRepository {
  save(person: Person): Promise<Person>;
  findById(id: string): Promise<Person | null>;
  findByEmail(email: string): Promise<Person | null>;
  findByTaxId(type: 'CPF' | 'CNPJ', value: string): Promise<Person | null>;
  update(person: Person): Promise<Person>;
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
  private emailValuesByPerson: Map<string, string[]> = new Map();

  async save(person: Person): Promise<Person> {
    this.replaceEmailIndex(person);
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

  async update(person: Person): Promise<Person> {
    this.replaceEmailIndex(person);
    this.persons.set(person.id, person);
    return person;
  }

  private replaceEmailIndex(person: Person): void {
    const newEmails = [...new Set(person.contactInfos
      .filter(contact => contact.type === 'email')
      .map(contact => contact.value.toLowerCase()))];

    for (const email of newEmails) {
      const existingId = this.emailIndex.get(email);
      if (existingId && existingId !== person.id) {
        throw new Error(PersonError.EMAIL_ALREADY_EXISTS);
      }
    }

    for (const email of this.emailValuesByPerson.get(person.id) ?? []) {
      if (this.emailIndex.get(email) === person.id) {
        this.emailIndex.delete(email);
      }
    }
    for (const email of newEmails) {
      this.emailIndex.set(email, person.id);
    }
    this.emailValuesByPerson.set(person.id, newEmails);
  }

  async delete(id: string): Promise<void> {
    if (this.persons.has(id)) {
      for (const email of this.emailValuesByPerson.get(id) ?? []) {
        if (this.emailIndex.get(email) === id) {
          this.emailIndex.delete(email);
        }
      }
      this.emailValuesByPerson.delete(id);
      this.persons.delete(id);
    }
  }

  clear(): void {
    this.persons.clear();
    this.emailIndex.clear();
    this.emailValuesByPerson.clear();
  }
}