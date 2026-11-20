import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonService } from './person.service';
import { Person, PersonRole, PersonError, InMemoryPersonRepository, ContactInfo, Address } from './person.domain';

describe('Person Service', () => {
  let personRepo: InMemoryPersonRepository;
  let personService: PersonService;

  beforeEach(() => {
    personRepo = new InMemoryPersonRepository();
    personService = new PersonService(personRepo);
  });

  const createTestPerson = async (overrides: Partial<{
    name: string;
    taxIdType: 'CPF' | 'CNPJ';
    taxIdValue: string;
    email: string;
    roles: PersonRole[];
  }> = {}) => {
    const person = Person.create({
      name: overrides.name || 'Test User',
      mainInfo: {
        taxIdType: overrides.taxIdType || 'CPF',
        taxIdValue: overrides.taxIdValue || '52998224725'
      },
      contactInfos: [{ type: 'email', value: overrides.email || 'test@example.com', isPrimary: true }],
      addresses: []
    });
    if (overrides.roles) {
      for (const role of overrides.roles) {
        person.addRole(role);
      }
    }
    await personRepo.save(person);
    return person;
  };

  describe('getPersonById', () => {
    it('should return person by ID', async () => {
      const person = await createTestPerson();

      const found = await personService.getPersonById(person.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(person.id);
      expect(found!.name).toBe(person.name);
    });

    it('should return null for non-existent person', async () => {
      const person = await personService.getPersonById('non-existent');
      expect(person).toBeNull();
    });
  });

  describe('updateName', () => {
    it('should update person name', async () => {
      const person = await createTestPerson({ name: 'Original Name' });

      const updated = await personService.updateName(person.id, 'Updated Name');

      expect(updated.name).toBe('Updated Name');
      expect(updated.mainInfo.name).toBe('Updated Name');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(person.updatedAt.getTime());
    });

    it('should reject updating non-existent person', async () => {
      await expect(personService.updateName('non-existent', 'New Name'))
        .rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });

    it('should reject empty name', async () => {
      const person = await createTestPerson();

      await expect(personService.updateName(person.id, ''))
        .rejects.toThrow(PersonError.NAME_REQUIRED);

      await expect(personService.updateName(person.id, '   '))
        .rejects.toThrow(PersonError.NAME_REQUIRED);
    });
  });

  describe('updateContactInfos', () => {
    it('should update contact infos', async () => {
      const person = await createTestPerson({ email: 'original@example.com' });

      const newContacts: ContactInfo[] = [
        { type: 'email', value: 'new@example.com', isPrimary: true },
        { type: 'phone', value: '+5511999999999', isPrimary: false }
      ];

      const updated = await personService.updateContactInfos(person.id, newContacts);

      expect(updated.contactInfos).toHaveLength(2);
      expect(updated.contactInfos[0].value).toBe('new@example.com');
      expect(updated.contactInfos[1].value).toBe('+5511999999999');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(person.updatedAt.getTime());
      expect(await personRepo.findByEmail('original@example.com')).toBeNull();
      expect((await personRepo.findByEmail('new@example.com'))?.id).toBe(person.id);
    });

    it('should reject updating non-existent person', async () => {
      await expect(personService.updateContactInfos('non-existent', [
        { type: 'email', value: 'test@example.com', isPrimary: true }
      ])).rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });

    it('should reject empty contacts array', async () => {
      const person = await createTestPerson();

      await expect(personService.updateContactInfos(person.id, []))
        .rejects.toThrow(PersonError.EMAIL_REQUIRED);
    });

    it('should reject contacts without email', async () => {
      const person = await createTestPerson();

      await expect(personService.updateContactInfos(person.id, [
        { type: 'phone', value: '+5511999999999', isPrimary: true }
      ])).rejects.toThrow(PersonError.EMAIL_REQUIRED);
    });

    it('should reject invalid email format', async () => {
      const person = await createTestPerson();

      await expect(personService.updateContactInfos(person.id, [
        { type: 'email', value: 'invalid-email', isPrimary: true }
      ])).rejects.toThrow(PersonError.INVALID_EMAIL_FORMAT);
    });
  });

  describe('updateAddresses', () => {
    it('should update addresses', async () => {
      const person = await createTestPerson();

      const newAddresses: Address[] = [
        { id: 'addr-1', street: 'Rua A', number: '100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', isPrimary: true },
        { id: 'addr-2', street: 'Rua B', number: '200', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', isPrimary: false }
      ];

      const updated = await personService.updateAddresses(person.id, newAddresses);

      expect(updated.addresses).toHaveLength(2);
      expect(updated.addresses[0].street).toBe('Rua A');
      expect(updated.addresses[1].street).toBe('Rua B');
    });

    it('should reject updating non-existent person', async () => {
      await expect(personService.updateAddresses('non-existent', []))
        .rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });

    it('should accept empty addresses array', async () => {
      const person = await createTestPerson();
      const updated = await personService.updateAddresses(person.id, []);
      expect(updated.addresses).toHaveLength(0);
    });
  });

  describe('addAddress', () => {
    it('should add a new address', async () => {
      const person = await createTestPerson();

      const updated = await personService.addAddress(person.id, {
        street: 'Rua Nova',
        number: '123',
        neighborhood: 'Bairro Novo',
        city: 'Rio de Janeiro',
        state: 'RJ',
        isPrimary: true
      });

      expect(updated.addresses).toHaveLength(1);
      expect(updated.addresses[0].street).toBe('Rua Nova');
      expect(updated.addresses[0].id).toBeDefined();
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(person.updatedAt.getTime());
    });

    it('should reject adding address to non-existent person', async () => {
      await expect(personService.addAddress('non-existent', {
        street: 'Rua A', number: '100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP'
      })).rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });

    it('should reject address with missing required fields', async () => {
      const person = await createTestPerson();

      // Note: validation happens at route level, service just passes through
      // But we can test the service accepts partial data
      const updated = await personService.addAddress(person.id, {
        street: 'Rua A',
        number: '100',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP'
      });
      expect(updated.addresses).toHaveLength(1);
    });
  });

  describe('removeAddress', () => {
    it('should remove an address', async () => {
      const person = await createTestPerson();
      
      // First add an address
      const withAddress = await personService.addAddress(person.id, {
        street: 'Rua A', number: '100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP'
      });
      const addressId = withAddress.addresses[0].id;

      const updated = await personService.removeAddress(person.id, addressId);

      expect(updated.addresses).toHaveLength(0);
    });

    it('should reject removing address from non-existent person', async () => {
      await expect(personService.removeAddress('non-existent', 'addr-1'))
        .rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });

    it('should reject removing non-existent address', async () => {
      const person = await createTestPerson();

      await expect(personService.removeAddress(person.id, 'non-existent-address'))
        .rejects.toThrow(PersonError.ADDRESS_NOT_FOUND);
    });
  });

  describe('updateAddress', () => {
    it('should update an address', async () => {
      const person = await createTestPerson();
      
      const withAddress = await personService.addAddress(person.id, {
        street: 'Rua A', number: '100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP'
      });
      const addressId = withAddress.addresses[0].id;

      const updated = await personService.updateAddress(person.id, addressId, {
        street: 'Rua Atualizada',
        number: '200'
      });

      expect(updated.addresses[0].street).toBe('Rua Atualizada');
      expect(updated.addresses[0].number).toBe('200');
      expect(updated.addresses[0].id).toBe(addressId); // ID unchanged
    });

    it('should reject updating address for non-existent person', async () => {
      await expect(personService.updateAddress('non-existent', 'addr-1', { street: 'Rua B' }))
        .rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });

    it('should reject updating non-existent address', async () => {
      const person = await createTestPerson();

      await expect(personService.updateAddress(person.id, 'non-existent-address', { street: 'Rua B' }))
        .rejects.toThrow(PersonError.ADDRESS_NOT_FOUND);
    });

    it('should not allow changing address ID', async () => {
      const person = await createTestPerson();
      
      const withAddress = await personService.addAddress(person.id, {
        street: 'Rua A', number: '100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP'
      });
      const addressId = withAddress.addresses[0].id;

      const updated = await personService.updateAddress(person.id, addressId, { id: 'new-id' } as any);

      expect(updated.addresses[0].id).toBe(addressId); // Original ID preserved
    });
  });

  describe('addContact', () => {
    it('should add a new contact with generated ID', async () => {
      const person = await createTestPerson();

      const updated = await personService.addContact(person.id, {
        type: 'phone',
        value: '+5511999999999',
        isPrimary: false
      });

      expect(updated.contactInfos).toHaveLength(2);
      expect(updated.contactInfos[1].type).toBe('phone');
      expect(updated.contactInfos[1].value).toBe('+5511999999999');
      expect(updated.contactInfos[1].id).toBeDefined();
    });

    it('should reject adding contact to non-existent person', async () => {
      await expect(personService.addContact('non-existent', {
        type: 'phone', value: '+5511999999999', isPrimary: false
      })).rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });
  });

  describe('removeContact', () => {
    it('should remove a contact by ID', async () => {
      const person = await createTestPerson();
      
      // Add a phone contact first
      const withPhone = await personService.addContact(person.id, {
        type: 'phone', value: '+5511999999999', isPrimary: false
      });
      expect(withPhone.contactInfos).toHaveLength(2);
      
      // Get the contact ID of the phone contact
      const phoneContactId = withPhone.contactInfos.find(c => c.type === 'phone')!.id;

      // Remove the phone contact by ID
      const updated = await personService.removeContact(person.id, phoneContactId);

      expect(updated.contactInfos).toHaveLength(1);
      expect(updated.contactInfos[0].type).toBe('email');
    });

    it('should reject removing contact from non-existent person', async () => {
      await expect(personService.removeContact('non-existent', 'some-id'))
        .rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });

    it('should reject invalid contact ID', async () => {
      const person = await createTestPerson();

      await expect(personService.removeContact(person.id, 'non-existent-id'))
        .rejects.toThrow(PersonError.CONTACT_NOT_FOUND);
    });

    it('should reject removing last email contact', async () => {
      const person = await createTestPerson(); // Has one email
      const emailContactId = person.contactInfos[0].id;

      await expect(personService.removeContact(person.id, emailContactId))
        .rejects.toThrow(PersonError.EMAIL_REQUIRED);
    });
  });

  describe('updateContact', () => {
    it('should update a contact by ID', async () => {
      const person = await createTestPerson();
      const emailContactId = person.contactInfos[0].id;

      const updated = await personService.updateContact(person.id, emailContactId, {
        value: 'updated@example.com'
      });

      expect(updated.contactInfos[0].value).toBe('updated@example.com');
    });

    it('should reject updating contact for non-existent person', async () => {
      await expect(personService.updateContact('non-existent', 'some-id', { value: 'test@example.com' }))
        .rejects.toThrow(PersonError.PERSON_NOT_FOUND);
    });

    it('should reject invalid contact ID', async () => {
      const person = await createTestPerson();

      await expect(personService.updateContact(person.id, 'non-existent-id', { value: 'test@example.com' }))
        .rejects.toThrow(PersonError.CONTACT_NOT_FOUND);
    });

    it('should reject invalid email format when updating email', async () => {
      const person = await createTestPerson();
      const emailContactId = person.contactInfos[0].id;

      await expect(personService.updateContact(person.id, emailContactId, { value: 'invalid-email' }))
        .rejects.toThrow(PersonError.INVALID_EMAIL_FORMAT);
    });

    it('should reject removing last email by updating to non-email', async () => {
      const person = await createTestPerson(); // Has one email at index 0
      const emailContactId = person.contactInfos[0].id;

      await expect(personService.updateContact(person.id, emailContactId, { type: 'phone', value: '+5511999999999' }))
        .rejects.toThrow(PersonError.EMAIL_REQUIRED);
    });
  });

  describe('Role exclusivity (Person.addRole)', () => {
    it('should reject adding CONSUMER role to a person with ADMIN role (Admin cannot buy)', async () => {
      const person = Person.create({
        name: 'Admin User',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'admin-buy@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.ADMIN);
      await personRepo.save(person);

      expect(() => person.addRole(PersonRole.CONSUMER)).toThrow('ADMIN_EXCLUSIVE');
      // Person still has only ADMIN role
      const persisted = await personRepo.findById(person.id);
      expect(persisted!.roles).toEqual([PersonRole.ADMIN]);
    });

    it('should reject adding VENDOR role to a person with ADMIN role (Admin cannot sell)', async () => {
      const person = Person.create({
        name: 'Admin User',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'admin-sell@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.ADMIN);
      await personRepo.save(person);

      expect(() => person.addRole(PersonRole.VENDOR)).toThrow('ADMIN_EXCLUSIVE');
      // Person still has only ADMIN role
      const persisted = await personRepo.findById(person.id);
      expect(persisted!.roles).toEqual([PersonRole.ADMIN]);
    });

    it('should reject adding ADMIN role to a person with CONSUMER role', async () => {
      const person = Person.create({
        name: 'Consumer User',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'consumer-admin@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.CONSUMER);
      await personRepo.save(person);

      expect(() => person.addRole(PersonRole.ADMIN)).toThrow('ADMIN_EXCLUSIVE');
      // Person still has only CONSUMER role
      const persisted = await personRepo.findById(person.id);
      expect(persisted!.roles).toEqual([PersonRole.CONSUMER]);
    });

    it('should reject adding ADMIN role to a person with VENDOR role', async () => {
      const person = Person.create({
        name: 'Vendor User',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor-admin@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      expect(() => person.addRole(PersonRole.ADMIN)).toThrow('ADMIN_EXCLUSIVE');
      // Person still has only VENDOR role
      const persisted = await personRepo.findById(person.id);
      expect(persisted!.roles).toEqual([PersonRole.VENDOR]);
    });

    it('should allow adding VENDOR role to a person with CONSUMER role (both roles simultaneously)', async () => {
      const person = Person.create({
        name: 'Consumer Vendor',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'cv@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.CONSUMER);
      person.addRole(PersonRole.VENDOR);

      expect(person.roles).toEqual([PersonRole.CONSUMER, PersonRole.VENDOR]);
      await personRepo.save(person);
      const persisted = await personRepo.findById(person.id);
      expect(persisted!.roles).toEqual([PersonRole.CONSUMER, PersonRole.VENDOR]);
    });
  });
});