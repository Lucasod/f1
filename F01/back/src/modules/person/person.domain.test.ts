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

  async update(person: Person): Promise<Person> {
    // Fetch existing person to clean up old email index entries
    const existingPerson = this.persons.get(person.id);
    if (existingPerson) {
      // Remove old emails from index
      for (const contact of existingPerson.contactInfos) {
        if (contact.type === 'email') {
          this.emailIndex.delete(contact.value.toLowerCase());
        }
      }
    }
    
    // Re-validate email uniqueness with new contacts
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
      expect(person.contactInfos[0].id).toBeDefined();
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

    it('should generate IDs for contacts when creating person', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [
          { type: 'email', value: 'john@example.com', isPrimary: true },
          { type: 'phone', value: '+5511999999999', isPrimary: false }
        ],
        addresses: []
      });

      expect(person.contactInfos[0].id).toBeDefined();
      expect(person.contactInfos[1].id).toBeDefined();
      expect(person.contactInfos[0].id).not.toBe(person.contactInfos[1].id);
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

    it('should add contact with generated ID', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      person.addContact({ type: 'phone', value: '+5511999999999', isPrimary: false, id: '' });

      expect(person.contactInfos).toHaveLength(2);
      expect(person.contactInfos[1].type).toBe('phone');
      expect(person.contactInfos[1].id).toBeDefined();
    });

    it('should remove contact by ID', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [
          { type: 'email', value: 'john@example.com', isPrimary: true },
          { type: 'phone', value: '+5511999999999', isPrimary: false }
        ],
        addresses: []
      });

      const phoneContactId = person.contactInfos[1].id;
      person.removeContact(phoneContactId);

      expect(person.contactInfos).toHaveLength(1);
      expect(person.contactInfos[0].type).toBe('email');
    });

    it('should reject removing non-existent contact by ID', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      expect(() => person.removeContact('non-existent-id')).toThrow('CONTACT_NOT_FOUND');
    });

    it('should reject removing last email contact', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      const emailContactId = person.contactInfos[0].id;
      expect(() => person.removeContact(emailContactId)).toThrow('EMAIL_REQUIRED');
    });

    it('should update contact by ID', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      const emailContactId = person.contactInfos[0].id;
      person.updateContact(emailContactId, { value: 'updated@example.com' });

      expect(person.contactInfos[0].value).toBe('updated@example.com');
      expect(person.contactInfos[0].id).toBe(emailContactId);
    });

    it('should reject updating non-existent contact by ID', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      expect(() => person.updateContact('non-existent-id', { value: 'test@example.com' })).toThrow('CONTACT_NOT_FOUND');
    });

    it('should reject invalid email format when updating email', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      const emailContactId = person.contactInfos[0].id;
      expect(() => person.updateContact(emailContactId, { value: 'invalid-email' })).toThrow('INVALID_EMAIL_FORMAT');
    });

    it('should reject removing last email by updating to non-email', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      const emailContactId = person.contactInfos[0].id;
      expect(() => person.updateContact(emailContactId, { type: 'phone', value: '+5511999999999' })).toThrow('EMAIL_REQUIRED');
    });

    it('should update contact infos and generate IDs for contacts without them', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      const newContacts = [
        { type: 'email', value: 'new@example.com', isPrimary: true },
        { type: 'phone', value: '+5511999999999', isPrimary: false }
      ];
      person.updateContactInfos(newContacts);

      expect(person.contactInfos).toHaveLength(2);
      expect(person.contactInfos[0].id).toBeDefined();
      expect(person.contactInfos[1].id).toBeDefined();
    });

    it('should preserve existing contact IDs when updating contact infos', () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true, id: 'existing-id' }],
        addresses: []
      });

      const newContacts = [
        { type: 'email', value: 'new@example.com', isPrimary: true, id: 'existing-id' },
        { type: 'phone', value: '+5511999999999', isPrimary: false }
      ];
      person.updateContactInfos(newContacts);

      expect(person.contactInfos).toHaveLength(2);
      expect(person.contactInfos[0].id).toBe('existing-id');
      expect(person.contactInfos[1].id).toBeDefined();
      expect(person.contactInfos[1].id).not.toBe('existing-id');
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

    it('should clean up old email index entries on update', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);

      // Update person with new email
      const updatedPerson = Person.reconstruct({
        ...person,
        contactInfos: [
          { type: 'email', value: 'john.new@example.com', isPrimary: true, id: person.contactInfos[0].id }
        ],
        updatedAt: new Date()
      });

      await repo.update(updatedPerson);

      // Old email should not be in index
      const oldEmailPerson = await repo.findByEmail('john@example.com');
      expect(oldEmailPerson).toBeNull();

      // New email should be in index
      const newEmailPerson = await repo.findByEmail('john.new@example.com');
      expect(newEmailPerson).not.toBeNull();
      expect(newEmailPerson!.id).toBe(person.id);
    });
  });
});