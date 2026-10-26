import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Person, PersonRole, PersonRepository } from './person.domain';

// Mock repository for testing
class InMemoryPersonRepository implements PersonRepository {
  private persons: Map<string, Person> = new Map();
  private emailIndex: Map<string, string> = new Map(); // email -> personId

  async save(person: Person): Promise<Person> {
    // Check email uniqueness
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

  // Test helper
  clear(): void {
    this.persons.clear();
    this.emailIndex.clear();
  }
}

describe('Person Domain', () => {
  let repo: InMemoryPersonRepository;

  beforeEach(() => {
    repo = new InMemoryPersonRepository();
  });

  describe('Person Entity', () => {
    it('should create a person with valid data', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [
          { type: 'email', value: 'john@example.com', isPrimary: true }
        ],
        addresses: []
      });

      expect(person.id).toBeDefined();
      expect(person.name).toBe('John Doe');
      expect(person.mainInfo.taxIdType).toBe('CPF');
      expect(person.mainInfo.taxIdValue).toBe('52998224725');
      expect(person.contactInfos).toHaveLength(1);
      expect(person.contactInfos[0].type).toBe('email');
      expect(person.contactInfos[0].value).toBe('john@example.com');
      expect(person.contactInfos[0].isPrimary).toBe(true);
      expect(person.roles).toEqual([]);
      expect(person.credential).toBeNull();
      expect(person.createdAt).toBeInstanceOf(Date);
      expect(person.updatedAt).toBeInstanceOf(Date);
    });

    it('should reject person without name', () => {
      expect(() => Person.create({
        name: '',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      })).toThrow('NAME_REQUIRED');
    });

    it('should reject person without tax ID', () => {
      expect(() => Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      })).toThrow('TAX_ID_REQUIRED');
    });

    it('should reject person without email contact', () => {
      expect(() => Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'phone', value: '+5511999999999', isPrimary: true }],
        addresses: []
      })).toThrow('EMAIL_REQUIRED');
    });

    it('should reject person with invalid email format', () => {
      expect(() => Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'invalid-email', isPrimary: true }],
        addresses: []
      })).toThrow('INVALID_EMAIL_FORMAT');
    });

    it('should allow adding roles', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      person.addRole(PersonRole.CONSUMER);
      expect(person.roles).toContain(PersonRole.CONSUMER);

      person.addRole(PersonRole.VENDOR);
      expect(person.roles).toContain(PersonRole.VENDOR);
      expect(person.roles).toHaveLength(2);
    });

    it('should not allow duplicate roles', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      person.addRole(PersonRole.CONSUMER);
      person.addRole(PersonRole.CONSUMER);
      expect(person.roles).toHaveLength(1);
    });

    it('should not allow Admin with Consumer or Vendor', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      person.addRole(PersonRole.CONSUMER);
      expect(() => person.addRole(PersonRole.ADMIN)).toThrow('ADMIN_EXCLUSIVE');
    });

    it('should set credential', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      person.setCredential('hashed-password');
      expect(person.credential).toBe('hashed-password');
    });

    it('should not allow setting credential twice', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      person.setCredential('hashed-password');
      expect(() => person.setCredential('another-hash')).toThrow('CREDENTIAL_ALREADY_SET');
    });
  });

  describe('InMemoryPersonRepository', () => {
    it('should save and find person by ID', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);
      const found = await repo.findById(person.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(person.id);
      expect(found!.name).toBe('John Doe');
    });

    it('should find person by email', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);
      const found = await repo.findByEmail('john@example.com');

      expect(found).not.toBeNull();
      expect(found!.email).toBe('john@example.com');
    });

    it('should find person by email case-insensitive', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'John@Example.COM', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);
      const found = await repo.findByEmail('john@example.com');

      expect(found).not.toBeNull();
    });

    it('should return null for non-existent email', async () => {
      const found = await repo.findByEmail('nonexistent@example.com');
      expect(found).toBeNull();
    });

    it('should reject duplicate email', async () => {
      const person1 = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      const person2 = Person.create({
        name: 'Jane Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224726' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person1);
      await expect(repo.save(person2)).rejects.toThrow('EMAIL_ALREADY_EXISTS');
    });

    it('should find person by tax ID', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);
      const found = await repo.findByTaxId('CPF', '52998224725');

      expect(found).not.toBeNull();
      expect(found!.mainInfo.taxIdValue).toBe('52998224725');
    });
  });
});