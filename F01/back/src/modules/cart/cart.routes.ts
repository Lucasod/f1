import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { CartService } from './cart.service';
import { CartError } from './cart.domain';
import { PersonRepository } from '../person/person.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';

export interface CartRoutesConfig {
  authService: AuthService;
  cartService: CartService;
  personRepo: PersonRepository;
}

export function createCartRoutes({ authService, cartService, personRepo }: CartRoutesConfig): Router {
  const router = Router();

  const authMw = authMiddleware(authService);
  const requireConsumer = requireRole(PersonRole.CONSUMER);

  // GET /cart - Get current cart (auth required, CONSUMER role)
  router.get('/', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const consumerId = req.user.sub;
      const cart = await cartService.getCart(consumerId);
      return res.json({ cart: cartToResponse(cart) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // POST /cart/items - Add item to cart (auth required, CONSUMER role)
  router.post('/items', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { productId, quantity } = req.body;

      if (!productId || typeof productId !== 'string' || productId.trim().length === 0) {
        return res.status(400).json({ error: 'PRODUCT_ID_REQUIRED', message: 'Product ID is required' });
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ error: CartError.INVALID_QUANTITY, message: 'Quantity must be a positive integer' });
      }

      const consumerId = req.user.sub;
      const cart = await cartService.addItem(consumerId, productId, quantity);

      return res.status(201).json({ cart: cartToResponse(cart) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case CartError.INVALID_QUANTITY:
            return res.status(400).json({ error: CartError.INVALID_QUANTITY, message: 'Quantity must be a positive integer' });
          case CartError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: CartError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case CartError.VENDOR_NOT_FOUND:
            return res.status(404).json({ error: CartError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
          case CartError.STOCK_INSUFFICIENT:
            return res.status(409).json({ error: CartError.STOCK_INSUFFICIENT, message: 'Insufficient stock' });
          case 'CONSUMER_ID_REQUIRED':
            return res.status(400).json({ error: 'CONSUMER_ID_REQUIRED', message: 'Consumer ID is required' });
          case 'INVALID_UNIT_PRICE':
            return res.status(400).json({ error: 'INVALID_UNIT_PRICE', message: 'Invalid unit price' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /cart/items/:productId - Update item quantity (auth required, CONSUMER role)
  router.patch('/items/:productId', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
      const { quantity } = req.body;

      if (!productId || productId.trim().length === 0) {
        return res.status(400).json({ error: 'PRODUCT_ID_REQUIRED', message: 'Product ID is required' });
      }

      if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ error: CartError.INVALID_QUANTITY, message: 'Quantity must be a non-negative integer' });
      }

      const consumerId = req.user.sub;
      const cart = await cartService.updateItemQuantity(consumerId, productId, quantity);

      return res.json({ cart: cartToResponse(cart) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case CartError.INVALID_QUANTITY:
            return res.status(400).json({ error: CartError.INVALID_QUANTITY, message: 'Quantity must be a non-negative integer' });
          case CartError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: CartError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case CartError.STOCK_INSUFFICIENT:
            return res.status(409).json({ error: CartError.STOCK_INSUFFICIENT, message: 'Insufficient stock' });
          case CartError.CART_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_NOT_FOUND, message: 'Cart not found' });
          case CartError.CART_ITEM_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_ITEM_NOT_FOUND, message: 'Cart item not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // DELETE /cart/items/:productId - Remove item from cart (auth required, CONSUMER role)
  router.delete('/items/:productId', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;

      if (!productId || productId.trim().length === 0) {
        return res.status(400).json({ error: 'PRODUCT_ID_REQUIRED', message: 'Product ID is required' });
      }

      const consumerId = req.user.sub;
      const cart = await cartService.removeItem(consumerId, productId);

      return res.json({ cart: cartToResponse(cart) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case CartError.CART_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_NOT_FOUND, message: 'Cart not found' });
          case CartError.CART_ITEM_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_ITEM_NOT_FOUND, message: 'Cart item not found' });
          case CartError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: CartError.PRODUCT_NOT_FOUND, message: 'Product not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /cart/merge-guest - Merge guest cart on login (auth required, CONSUMER role)
  router.post('/merge-guest', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { guestCartId } = req.body;

      if (!guestCartId || typeof guestCartId !== 'string' || guestCartId.trim().length === 0) {
        return res.status(400).json({ error: 'GUEST_CART_ID_REQUIRED', message: 'Guest cart ID is required' });
      }

      const consumerId = req.user.sub;
      const cart = await cartService.mergeGuestCart(guestCartId, consumerId);

      return res.json({ cart: cartToResponse(cart) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case CartError.CART_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_NOT_FOUND, message: 'Cart not found' });
          case CartError.CART_EMPTY:
            return res.status(400).json({ error: CartError.CART_EMPTY, message: 'Cart is empty' });
          case 'CONSUMER_ID_REQUIRED':
            return res.status(400).json({ error: 'CONSUMER_ID_REQUIRED', message: 'Consumer ID is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}

function cartToResponse(cart: any) {
  return {
    id: cart.id,
    items: cart.items.map((item: any) => ({
      productId: item.productId,
      vendorId: item.vendorId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      addedAt: item.addedAt,
    })),
    version: cart.version,
    updatedAt: cart.updatedAt,
  };
}