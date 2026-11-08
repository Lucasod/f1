import { describe, it, expect, beforeEach } from 'vitest';
import { Cart, CartError, InMemoryCartRepository, generateGuestCartId, isGuestCartId, isValidGuestCartId } from './cart.domain';

describe('Cart Domain', () => {
  let repo: InMemoryCartRepository;

  beforeEach(() => {
    repo = new InMemoryCartRepository();
  });

  describe('Cart Entity', () => {
    describe('create', () => {
      it('should create a cart with valid consumerId', () => {
        const consumerId = 'consumer-123';
        const cart = Cart.create(consumerId);

        expect(cart.id).toBe(consumerId);
        expect(cart.items).toEqual([]);
        expect(cart.updatedAt).toBeInstanceOf(Date);
        expect(cart.version).toBe(1);
        expect(cart.isEmpty).toBe(true);
        expect(cart.totalItems).toBe(0);
      });

      it('should throw on empty consumerId', () => {
        expect(() => Cart.create('')).toThrow('CONSUMER_ID_REQUIRED');
        expect(() => Cart.create('   ')).toThrow('CONSUMER_ID_REQUIRED');
      });
    });

    describe('reconstruct', () => {
      it('should restore cart correctly from CartData', () => {
        const data = {
          id: 'consumer-456',
          items: [
            {
              productId: 'prod-1',
              vendorId: 'vendor-1',
              quantity: 2,
              addedAt: new Date('2024-01-15T10:00:00Z'),
              unitPrice: 29.99,
            },
          ],
          updatedAt: new Date('2024-01-15T10:30:00Z'),
          version: 3,
        };

        const cart = Cart.reconstruct(data);

        expect(cart.id).toBe('consumer-456');
        expect(cart.items).toHaveLength(1);
        expect(cart.items[0].productId).toBe('prod-1');
        expect(cart.items[0].quantity).toBe(2);
        expect(cart.items[0].unitPrice).toBe(29.99);
        expect(cart.updatedAt).toEqual(new Date('2024-01-15T10:30:00Z'));
        expect(cart.version).toBe(3);
        expect(cart.isEmpty).toBe(false);
        expect(cart.totalItems).toBe(2);
      });

      it('should handle empty items array in reconstructed data', () => {
        const data = {
          id: 'consumer-789',
          items: [],
          updatedAt: new Date(),
          version: 1,
        };

        const cart = Cart.reconstruct(data);

        expect(cart.items).toEqual([]);
        expect(cart.isEmpty).toBe(true);
      });
    });

    describe('addItem', () => {
      it('should add a new item to empty cart', () => {
        const cart = Cart.create('consumer-123');

        cart.addItem('prod-1', 'vendor-1', 2, 29.99);

        expect(cart.items).toHaveLength(1);
        expect(cart.items[0]).toEqual({
          productId: 'prod-1',
          vendorId: 'vendor-1',
          quantity: 2,
          unitPrice: 29.99,
          addedAt: expect.any(Date),
        });
        expect(cart.totalItems).toBe(2);
        expect(cart.version).toBe(1); // version not incremented on addItem
      });

      it('should merge quantity when adding existing product', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);

        cart.addItem('prod-1', 'vendor-1', 3, 29.99);

        expect(cart.items).toHaveLength(1);
        expect(cart.items[0].quantity).toBe(5);
        expect(cart.totalItems).toBe(5);
      });

      it('should throw on empty productId', () => {
        const cart = Cart.create('consumer-123');

        expect(() => cart.addItem('', 'vendor-1', 1, 10)).toThrow(CartError.PRODUCT_NOT_FOUND);
        expect(() => cart.addItem('   ', 'vendor-1', 1, 10)).toThrow(CartError.PRODUCT_NOT_FOUND);
      });

      it('should throw on empty vendorId', () => {
        const cart = Cart.create('consumer-123');

        expect(() => cart.addItem('prod-1', '', 1, 10)).toThrow(CartError.VENDOR_NOT_FOUND);
        expect(() => cart.addItem('prod-1', '   ', 1, 10)).toThrow(CartError.VENDOR_NOT_FOUND);
      });

      it('should throw on invalid quantity (zero)', () => {
        const cart = Cart.create('consumer-123');

        expect(() => cart.addItem('prod-1', 'vendor-1', 0, 10)).toThrow(CartError.INVALID_QUANTITY);
      });

      it('should throw on invalid quantity (negative)', () => {
        const cart = Cart.create('consumer-123');

        expect(() => cart.addItem('prod-1', 'vendor-1', -1, 10)).toThrow(CartError.INVALID_QUANTITY);
      });

      it('should throw on invalid quantity (non-integer)', () => {
        const cart = Cart.create('consumer-123');

        expect(() => cart.addItem('prod-1', 'vendor-1', 1.5, 10)).toThrow(CartError.INVALID_QUANTITY);
      });

      it('should throw on invalid unitPrice (negative)', () => {
        const cart = Cart.create('consumer-123');

        expect(() => cart.addItem('prod-1', 'vendor-1', 1, -1)).toThrow('INVALID_UNIT_PRICE');
      });

      it('should throw on invalid unitPrice (NaN)', () => {
        const cart = Cart.create('consumer-123');

        expect(() => cart.addItem('prod-1', 'vendor-1', 1, NaN)).toThrow('INVALID_UNIT_PRICE');
      });

      it('should throw on invalid unitPrice (Infinity)', () => {
        const cart = Cart.create('consumer-123');

        expect(() => cart.addItem('prod-1', 'vendor-1', 1, Infinity)).toThrow('INVALID_UNIT_PRICE');
      });

      it('should update timestamp on addItem', () => {
        const cart = Cart.create('consumer-123');
        const initialUpdatedAt = cart.updatedAt;

        // Small delay to ensure timestamp changes
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        expect(cart.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime());
      });
    });

    describe('updateItemQuantity', () => {
      it('should update quantity of existing item', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);

        cart.updateItemQuantity('prod-1', 5);

        expect(cart.items[0].quantity).toBe(5);
        expect(cart.totalItems).toBe(5);
      });

      it('should remove item when quantity is set to 0', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);

        cart.updateItemQuantity('prod-1', 0);

        expect(cart.items).toHaveLength(0);
        expect(cart.isEmpty).toBe(true);
        expect(cart.totalItems).toBe(0);
      });

      it('should throw on empty productId', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        expect(() => cart.updateItemQuantity('', 1)).toThrow(CartError.PRODUCT_NOT_FOUND);
        expect(() => cart.updateItemQuantity('   ', 1)).toThrow(CartError.PRODUCT_NOT_FOUND);
      });

      it('should throw on invalid quantity (negative)', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        expect(() => cart.updateItemQuantity('prod-1', -1)).toThrow(CartError.INVALID_QUANTITY);
      });

      it('should throw on invalid quantity (non-integer)', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        expect(() => cart.updateItemQuantity('prod-1', 1.5)).toThrow(CartError.INVALID_QUANTITY);
      });

      it('should throw when item not found', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        expect(() => cart.updateItemQuantity('prod-999', 1)).toThrow(CartError.CART_ITEM_NOT_FOUND);
      });

      it('should update timestamp on updateItemQuantity', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);
        const initialUpdatedAt = cart.updatedAt;

        cart.updateItemQuantity('prod-1', 5);

        expect(cart.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime());
      });
    });

    describe('removeItem', () => {
      it('should remove existing item', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);
        cart.addItem('prod-2', 'vendor-1', 1, 19.99);

        cart.removeItem('prod-1');

        expect(cart.items).toHaveLength(1);
        expect(cart.items[0].productId).toBe('prod-2');
        expect(cart.totalItems).toBe(1);
      });

      it('should throw on empty productId', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        expect(() => cart.removeItem('')).toThrow(CartError.PRODUCT_NOT_FOUND);
        expect(() => cart.removeItem('   ')).toThrow(CartError.PRODUCT_NOT_FOUND);
      });

      it('should throw when item not found', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        expect(() => cart.removeItem('prod-999')).toThrow(CartError.CART_ITEM_NOT_FOUND);
      });

      it('should update timestamp on removeItem', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);
        const initialUpdatedAt = cart.updatedAt;

        cart.removeItem('prod-1');

        expect(cart.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime());
      });
    });

    describe('getItems', () => {
      it('should return defensive copy of items', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);

        const items = cart.getItems();
        items.push({
          productId: 'prod-2',
          vendorId: 'vendor-2',
          quantity: 1,
          addedAt: new Date(),
          unitPrice: 10,
        });

        expect(cart.items).toHaveLength(1);
      });

      it('should return empty array for empty cart', () => {
        const cart = Cart.create('consumer-123');

        expect(cart.getItems()).toEqual([]);
      });
    });

    describe('getItem', () => {
      it('should return item when found', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);

        const item = cart.getItem('prod-1');

        expect(item).toBeDefined();
        expect(item!.productId).toBe('prod-1');
        expect(item!.quantity).toBe(2);
        expect(item!.unitPrice).toBe(29.99);
      });

      it('should return undefined when item not found', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        expect(cart.getItem('prod-999')).toBeUndefined();
      });

      it('should return undefined on empty productId', () => {
        const cart = Cart.create('consumer-123');

        expect(cart.getItem('')).toBeUndefined();
        expect(cart.getItem('   ')).toBeUndefined();
      });
    });

    describe('clear', () => {
      it('should empty the cart', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);
        cart.addItem('prod-2', 'vendor-2', 1, 19.99);

        cart.clear();

        expect(cart.items).toEqual([]);
        expect(cart.isEmpty).toBe(true);
        expect(cart.totalItems).toBe(0);
      });

      it('should update timestamp on clear', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);
        const initialUpdatedAt = cart.updatedAt;

        cart.clear();

        expect(cart.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime());
      });
    });

    describe('mergeGuestCart', () => {
      it('should merge guest cart items into existing cart', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);

        const guestItems = [
          { productId: 'prod-2', vendorId: 'vendor-2', quantity: 3, addedAt: new Date(), unitPrice: 19.99 },
          { productId: 'prod-3', vendorId: 'vendor-1', quantity: 1, addedAt: new Date(), unitPrice: 9.99 },
        ];

        cart.mergeGuestCart(guestItems);

        expect(cart.items).toHaveLength(3);
        expect(cart.totalItems).toBe(6);
      });

      it('should sum quantities when merging existing products', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);

        const guestItems = [
          { productId: 'prod-1', vendorId: 'vendor-1', quantity: 3, addedAt: new Date(), unitPrice: 29.99 },
        ];

        cart.mergeGuestCart(guestItems);

        expect(cart.items).toHaveLength(1);
        expect(cart.items[0].quantity).toBe(5);
        expect(cart.totalItems).toBe(5);
      });

      it('should handle empty guest cart', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        cart.mergeGuestCart([]);
        cart.mergeGuestCart(null as any);

        expect(cart.items).toHaveLength(1);
        expect(cart.totalItems).toBe(1);
      });

      it('should use guest item addedAt and unitPrice when adding new items', () => {
        const cart = Cart.create('consumer-123');
        const guestAddedAt = new Date('2024-01-01T00:00:00Z');

        cart.mergeGuestCart([
          { productId: 'prod-1', vendorId: 'vendor-1', quantity: 1, addedAt: guestAddedAt, unitPrice: 15.50 },
        ]);

        expect(cart.items[0].addedAt).toEqual(guestAddedAt);
        expect(cart.items[0].unitPrice).toBe(15.50);
      });

      it('should update timestamp on mergeGuestCart', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);
        const initialUpdatedAt = cart.updatedAt;

        cart.mergeGuestCart([
          { productId: 'prod-2', vendorId: 'vendor-2', quantity: 1, addedAt: new Date(), unitPrice: 20 },
        ]);

        expect(cart.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime());
      });
    });

    describe('getters', () => {
      it('should return true for isEmpty on new cart', () => {
        const cart = Cart.create('consumer-123');
        expect(cart.isEmpty).toBe(true);
      });

      it('should return false for isEmpty when cart has items', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);
        expect(cart.isEmpty).toBe(false);
      });

      it('should return true for isEmpty after clear', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);
        cart.clear();
        expect(cart.isEmpty).toBe(true);
      });

      it('should return correct totalItems', () => {
        const cart = Cart.create('consumer-123');
        expect(cart.totalItems).toBe(0);

        cart.addItem('prod-1', 'vendor-1', 2, 10);
        expect(cart.totalItems).toBe(2);

        cart.addItem('prod-2', 'vendor-1', 3, 20);
        expect(cart.totalItems).toBe(5);

        cart.updateItemQuantity('prod-1', 4);
        expect(cart.totalItems).toBe(7);

        cart.removeItem('prod-2');
        expect(cart.totalItems).toBe(4);
      });
    });

    describe('toJSON', () => {
      it('should serialize cart correctly', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 2, 29.99);
        cart.addItem('prod-2', 'vendor-2', 1, 19.99);

        const json = cart.toJSON();

        expect(json).toEqual({
          id: 'consumer-123',
          generation: cart.generation,
          items: [
            { productId: 'prod-1', vendorId: 'vendor-1', quantity: 2, addedAt: expect.any(Date), unitPrice: 29.99 },
            { productId: 'prod-2', vendorId: 'vendor-2', quantity: 1, addedAt: expect.any(Date), unitPrice: 19.99 },
          ],
          updatedAt: expect.any(Date),
          version: 1,
        });
      });

      it('should return defensive copy of items', () => {
        const cart = Cart.create('consumer-123');
        cart.addItem('prod-1', 'vendor-1', 1, 10);

        const json = cart.toJSON();
        json.items.push({ productId: 'prod-2', vendorId: 'vendor-2', quantity: 1, addedAt: new Date(), unitPrice: 20 });

        expect(cart.items).toHaveLength(1);
      });
    });

    describe('incrementVersion', () => {
      it('should increment version and update timestamp', () => {
        const cart = Cart.create('consumer-123');
        expect(cart.version).toBe(1);

        cart.incrementVersion();

        expect(cart.version).toBe(2);
      });
    });
  });

  describe('InMemoryCartRepository', () => {
    it('should save and find cart by ID', async () => {
      const cart = Cart.create('consumer-123');
      cart.addItem('prod-1', 'vendor-1', 2, 29.99);

      await repo.save(cart);
      const found = await repo.findById('consumer-123');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('consumer-123');
      expect(found!.items).toHaveLength(1);
      expect(found!.items[0].productId).toBe('prod-1');
    });

    it('should return null for non-existent cart', async () => {
      const found = await repo.findById('nonexistent');
      expect(found).toBeNull();
    });

    it('should update existing cart', async () => {
      const cart = Cart.create('consumer-123');
      cart.addItem('prod-1', 'vendor-1', 1, 10);
      await repo.save(cart);

      cart.addItem('prod-2', 'vendor-2', 2, 20);
      const updated = await repo.update(cart);

      expect(updated.items).toHaveLength(2);
      expect(updated.totalItems).toBe(3);

      const found = await repo.findById('consumer-123');
      expect(found!.items).toHaveLength(2);
    });

    it('should throw on update non-existent cart', async () => {
      const cart = Cart.create('consumer-999');
      cart.addItem('prod-1', 'vendor-1', 1, 10);

      await expect(repo.update(cart)).rejects.toThrow(CartError.CART_NOT_FOUND);
    });

    it('should delete cart', async () => {
      const cart = Cart.create('consumer-123');
      cart.addItem('prod-1', 'vendor-1', 1, 10);
      await repo.save(cart);

      await repo.delete('consumer-123');

      const found = await repo.findById('consumer-123');
      expect(found).toBeNull();
    });

    it('should not throw on delete non-existent cart', async () => {
      await expect(repo.delete('nonexistent')).resolves.not.toThrow();
    });

    it('should clear all carts', async () => {
      const cart1 = Cart.create('consumer-1');
      cart1.addItem('prod-1', 'vendor-1', 1, 10);
      const cart2 = Cart.create('consumer-2');
      cart2.addItem('prod-2', 'vendor-2', 2, 20);

      await repo.save(cart1);
      await repo.save(cart2);

      repo.clear();

      expect(await repo.findById('consumer-1')).toBeNull();
      expect(await repo.findById('consumer-2')).toBeNull();
    });
  });

  describe('Guest Cart Utilities', () => {
    describe('generateGuestCartId', () => {
      it('should generate a guest cart ID with correct prefix', () => {
        const id = generateGuestCartId();
        expect(id).toMatch(/^guest:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      });

      it('should generate unique IDs on each call', () => {
        const id1 = generateGuestCartId();
        const id2 = generateGuestCartId();
        expect(id1).not.toBe(id2);
      });
    });

    describe('isGuestCartId', () => {
      it('should return true for valid guest cart ID', () => {
        expect(isGuestCartId('guest:12345678-1234-4123-8123-123456789abc')).toBe(true);
        expect(isGuestCartId('guest:abcd')).toBe(true);
      });

      it('should return false for non-guest IDs', () => {
        expect(isGuestCartId('user:123')).toBe(false);
        expect(isGuestCartId('consumer-123')).toBe(false);
        expect(isGuestCartId('')).toBe(false);
        expect(isGuestCartId('guest')).toBe(false);
      });
    });

    describe('isValidGuestCartId', () => {
      it('should return true for valid v4 UUID guest cart ID', () => {
        const validId = 'guest:12345678-1234-4123-8123-123456789abc';
        expect(isValidGuestCartId(validId)).toBe(true);
      });

      it('should return false for invalid UUID format', () => {
        expect(isValidGuestCartId('guest:not-a-uuid')).toBe(false);
        expect(isValidGuestCartId('guest:12345678-1234-1123-8123-123456789abc')).toBe(false); // Not v4
        expect(isValidGuestCartId('guest:12345678-1234-4123-7123-123456789abc')).toBe(false); // Invalid variant
      });

      it('should return false for non-guest IDs', () => {
        expect(isValidGuestCartId('user:12345678-1234-4123-8123-123456789abc')).toBe(false);
        expect(isValidGuestCartId('consumer-123')).toBe(false);
        expect(isValidGuestCartId('')).toBe(false);
      });
    });
  });
});
