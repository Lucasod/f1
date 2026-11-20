import { describe, expect, it, vi } from 'vitest';
import { MongoPersonRepository } from './person.mongo.repository';
import { Person } from './person.domain';

function createRepository() {
  const people = { updateOne: vi.fn().mockResolvedValue({}), findOne: vi.fn() };
  const mainInfos = { updateOne: vi.fn().mockResolvedValue({}), findOne: vi.fn().mockResolvedValue(null) };
  const credentials = { updateOne: vi.fn().mockResolvedValue({}), findOne: vi.fn().mockResolvedValue(null), deleteOne: vi.fn() };
  const addresses = { deleteMany: vi.fn(), insertMany: vi.fn(), find: vi.fn(() => ({ toArray: async () => [] })) };
  const contacts = { deleteMany: vi.fn(), insertMany: vi.fn(), findOne: vi.fn().mockResolvedValue(null), find: vi.fn(() => ({ toArray: async () => [] })) };
  const collections: Record<string, unknown> = { people, main_infos: mainInfos, credentials, addresses, contact_infos: contacts };
  return { repo: new MongoPersonRepository({ collection: (name: string) => collections[name] } as never), people, mainInfos };
}

describe('Stripe customer persistence', () => {
  it('writes a linked Stripe customer ID on the person', async () => {
    const { repo, people } = createRepository();
    const person = Person.create({ name: 'Buyer', mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' }, contactInfos: [{ type: 'email', value: 'buyer@example.test', isPrimary: true }], addresses: [] });
    person.setStripeCustomerId('cus_test_buyer');
    await repo.save(person);
    expect(people.updateOne.mock.calls[0][1].$set.stripeCustomerId).toBe('cus_test_buyer');
  });

  it('restores the Stripe customer ID when loading a person', async () => {
    const { repo, people, mainInfos } = createRepository();
    people.findOne.mockResolvedValue({ _id: 'person', roles: [], createdAt: new Date(), updatedAt: new Date(), stripeCustomerId: 'cus_test_buyer' });
    mainInfos.findOne.mockResolvedValue({ name: 'Buyer', tax_id: { type: 'CPF', value: '52998224725' } });
    expect((await repo.findById('person'))?.stripeCustomerId).toBe('cus_test_buyer');
  });
});
