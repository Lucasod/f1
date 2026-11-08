import { it, expect } from 'vitest';
import { MongoCouponRepository } from './coupon.mongo.repository';
import { validateTerms } from './coupon.domain';

it('atomically rejects canonical duplicates across instances and restores detached immutable terms', async () => {
  const docs = new Map<string, any>();
  const db = { collection: () => ({
    insertOne: async (d: any) => { if (docs.has(d._id)) throw { code: 11000 }; docs.set(d._id, structuredClone(d)); },
    findOne: async ({ _id }: any) => structuredClone(docs.get(_id) ?? null),
    find: ({ vendorId }: any) => ({ toArray: async () => structuredClone([...docs.values()].filter(d => d.vendorId === vendorId)) }),
  }) } as any;
  const a = new MongoCouponRepository(db), b = new MongoCouponRepository(db);
  const terms = validateTerms({ code: ' SAVE ', discountType: 'fixedMinorBRL', value: 1, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', includeProducts: ['p1'] }, 'vendor');
  const results = await Promise.allSettled([a.insert(terms), b.insert(terms)]);
  expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'COUPON_CONFLICT' });
  terms.includeProducts.push('not-persisted');
  const restored = (await b.find('vendor', 'save'))!;
  expect(restored.includeProducts).toEqual(['p1']); restored.includeProducts.push('not-persisted-either');
  expect((await a.list('vendor'))[0].includeProducts).toEqual(['p1']);
  expect(await a.list('other')).toEqual([]);
  docs.get(restored.id).revision = 2;
  await expect(b.find('vendor', 'SAVE')).rejects.toThrow();
});
