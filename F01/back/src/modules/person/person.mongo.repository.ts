import { Db, Collection } from 'mongodb';
import { Person, PersonError, PersonRepository, PersonRole, ContactInfo, Address, MainInfo } from './person.domain';

interface PersonDoc {
  _id: string;
  roles: PersonRole[];
  createdAt: Date;
  updatedAt: Date;
}

interface MainInfoDoc {
  _id: string;
  person_id: string;
  name: string;
  tax_id: {
    type: 'CPF' | 'CNPJ';
    value: string;
  };
}

interface CredentialDoc {
  _id: string;
  person_id: string;
  hashedPassword: string;
}

interface AddressDoc {
  _id: string;
  person_id: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  is_primary: boolean;
}

interface ContactInfoDoc {
  _id: string;
  person_id: string;
  type: 'email' | 'phone' | 'whatsapp';
  value: string;
  is_primary: boolean;
}

export class MongoPersonRepository implements PersonRepository {
  private peopleCollection: Collection<PersonDoc>;
  private mainInfosCollection: Collection<MainInfoDoc>;
  private credentialsCollection: Collection<CredentialDoc>;
  private addressesCollection: Collection<AddressDoc>;
  private contactInfosCollection: Collection<ContactInfoDoc>;

  constructor(db: Db) {
    this.peopleCollection = db.collection<PersonDoc>('people');
    this.mainInfosCollection = db.collection<MainInfoDoc>('main_infos');
    this.credentialsCollection = db.collection<CredentialDoc>('credentials');
    this.addressesCollection = db.collection<AddressDoc>('addresses');
    this.contactInfosCollection = db.collection<ContactInfoDoc>('contact_infos');
  }

  async save(person: Person): Promise<Person> {
    const personId = person.id;

    // Check for duplicate email before saving
    for (const contact of person.contactInfos) {
      if (contact.type === 'email') {
        const existingContact = await this.contactInfosCollection.findOne({
          type: 'email',
          value: contact.value,
          person_id: { $ne: personId }
        });
        if (existingContact) {
          throw new Error(PersonError.EMAIL_ALREADY_EXISTS);
        }
      }
    }

    // Check for duplicate tax ID
    const existingMainInfo = await this.mainInfosCollection.findOne({
      'tax_id.value': person.mainInfo.taxIdValue,
      person_id: { $ne: personId }
    });
    if (existingMainInfo) {
      throw new Error('TAX_ID_ALREADY_EXISTS');
    }

    const now = new Date();

    // Upsert person document
    await this.peopleCollection.updateOne(
      { _id: personId },
      {
        $set: {
          roles: person.roles,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: person.createdAt
        }
      },
      { upsert: true }
    );

    // Upsert main info
    await this.mainInfosCollection.updateOne(
      { person_id: personId },
      {
        $set: {
          name: person.name,
          tax_id: {
            type: person.mainInfo.taxIdType,
            value: person.mainInfo.taxIdValue
          }
        }
      },
      { upsert: true }
    );

    // Upsert credential if present
    if (person.credential) {
      await this.credentialsCollection.updateOne(
        { person_id: personId },
        {
          $set: {
            hashedPassword: person.credential
          }
        },
        { upsert: true }
      );
    } else {
      // Remove credential if it was cleared
      await this.credentialsCollection.deleteOne({ person_id: personId });
    }

    // Replace addresses
    await this.addressesCollection.deleteMany({ person_id: personId });
    if (person.addresses.length > 0) {
      const addressDocs: AddressDoc[] = person.addresses.map(addr => ({
        _id: addr.id,
        person_id: personId,
        street: addr.street,
        number: addr.number,
        neighborhood: addr.neighborhood,
        city: addr.city,
        state: addr.state,
        is_primary: addr.isPrimary || false
      }));
      await this.addressesCollection.insertMany(addressDocs);
    }

    // Replace contact infos
    await this.contactInfosCollection.deleteMany({ person_id: personId });
    if (person.contactInfos.length > 0) {
      const contactDocs: ContactInfoDoc[] = person.contactInfos.map(contact => ({
        _id: contact.id,
        person_id: personId,
        type: contact.type,
        value: contact.value,
        is_primary: contact.isPrimary
      }));
      await this.contactInfosCollection.insertMany(contactDocs);
    }

    // Return updated person with new timestamps
    return Person.reconstruct({
      ...person,
      updatedAt: now
    } as any);
  }

  async findById(id: string): Promise<Person | null> {
    const [personDoc, mainInfoDoc, credentialDoc, addressDocs, contactDocs] = await Promise.all([
      this.peopleCollection.findOne({ _id: id }),
      this.mainInfosCollection.findOne({ person_id: id }),
      this.credentialsCollection.findOne({ person_id: id }),
      this.addressesCollection.find({ person_id: id }).toArray(),
      this.contactInfosCollection.find({ person_id: id }).toArray()
    ]);

    if (!personDoc || !mainInfoDoc) {
      return null;
    }

    return this.mapToPerson(personDoc, mainInfoDoc, credentialDoc, addressDocs, contactDocs);
  }

  async findByEmail(email: string): Promise<Person | null> {
    const contactDoc = await this.contactInfosCollection.findOne({
      type: 'email',
      value: { $regex: new RegExp(`^${email}$`, 'i') }
    });

    if (!contactDoc) {
      return null;
    }

    return this.findById(contactDoc.person_id);
  }

  async findByTaxId(type: 'CPF' | 'CNPJ', value: string): Promise<Person | null> {
    const mainInfoDoc = await this.mainInfosCollection.findOne({
      'tax_id.type': type,
      'tax_id.value': value
    });

    if (!mainInfoDoc) {
      return null;
    }

    return this.findById(mainInfoDoc.person_id);
  }

  async update(person: Person): Promise<Person> {
    // Reuse save logic which handles updates/upserts
    return this.save(person);
  }

  async delete(id: string): Promise<void> {
    const personDoc = await this.peopleCollection.findOne({ _id: id });
    if (!personDoc) {
      return;
    }

    await Promise.all([
      this.peopleCollection.deleteOne({ _id: id }),
      this.mainInfosCollection.deleteOne({ person_id: id }),
      this.credentialsCollection.deleteOne({ person_id: id }),
      this.addressesCollection.deleteMany({ person_id: id }),
      this.contactInfosCollection.deleteMany({ person_id: id })
    ]);
  }

  private mapToPerson(
    personDoc: PersonDoc,
    mainInfoDoc: MainInfoDoc,
    credentialDoc: CredentialDoc | null,
    addressDocs: AddressDoc[],
    contactDocs: ContactInfoDoc[]
  ): Person {
    const contactInfos: ContactInfo[] = contactDocs.map(doc => ({
      id: doc._id,
      type: doc.type,
      value: doc.value,
      isPrimary: doc.is_primary
    }));

    const addresses: Address[] = addressDocs.map(doc => ({
      id: doc._id,
      street: doc.street,
      number: doc.number,
      neighborhood: doc.neighborhood,
      city: doc.city,
      state: doc.state,
      isPrimary: doc.is_primary
    }));

    const personData = {
      id: personDoc._id,
      name: mainInfoDoc.name,
      mainInfo: {
        name: mainInfoDoc.name,
        taxIdType: mainInfoDoc.tax_id.type,
        taxIdValue: mainInfoDoc.tax_id.value
      },
      contactInfos,
      addresses,
      roles: personDoc.roles,
      credential: credentialDoc?.hashedPassword || null,
      createdAt: personDoc.createdAt,
      updatedAt: personDoc.updatedAt
    };

    return Person.reconstruct(personData);
  }
}