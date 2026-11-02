import { Person, PersonError, PersonRepository, ContactInfo, Address } from './person.domain';

export class PersonService {
  private readonly personRepo: PersonRepository;

  constructor(personRepo: PersonRepository) {
    this.personRepo = personRepo;
  }

  async getPersonById(id: string): Promise<Person | null> {
    return this.personRepo.findById(id);
  }

  async updateName(personId: string, name: string): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.updateName(name);
    return this.personRepo.update(person);
  }

  async updateContactInfos(personId: string, contacts: ContactInfo[]): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.updateContactInfos(contacts);
    return this.personRepo.update(person);
  }

  async updateAddresses(personId: string, addresses: Address[]): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.updateAddresses(addresses);
    return this.personRepo.update(person);
  }

  async addAddress(personId: string, address: Omit<Address, 'id'>): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.addAddress(address);
    return this.personRepo.update(person);
  }

  async removeAddress(personId: string, addressId: string): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.removeAddress(addressId);
    return this.personRepo.update(person);
  }

  async updateAddress(personId: string, addressId: string, updates: Partial<Address>): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.updateAddress(addressId, updates);
    return this.personRepo.update(person);
  }

  async addContact(personId: string, contact: Omit<ContactInfo, 'id'>): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.addContact(contact);
    return this.personRepo.update(person);
  }

  async removeContact(personId: string, contactId: string): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.removeContact(contactId);
    return this.personRepo.update(person);
  }

  async updateContact(personId: string, contactId: string, updates: Partial<ContactInfo>): Promise<Person> {
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(PersonError.PERSON_NOT_FOUND);
    }

    person.updateContact(contactId, updates);
    return this.personRepo.update(person);
  }
}