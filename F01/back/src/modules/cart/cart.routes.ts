import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { CartService } from './cart.service';
import { CartError, generateGuestCartId, isValidGuestCartId, isGuestCartId } from './cart.domain';
import { PersonRepository } from '../person/person.domain';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest, OptionalAuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';

export interface CartRoutesConfig {
  authService: AuthService;
  cartService: CartService;
  personRepo: PersonRepository;
}

export function createCartRoutes({ authService, cartService, personRepo }: CartRoutesConfig): Router {
  const router = Router();

  const authMw = authMiddleware(authService);
  const optionalAuthMw = optionalAuthMiddleware(authService);
  const requireConsumer = requireRole(PersonRole.CONSUMER);

  // Helper to determine cart ID from request
  const getCartId = (req: OptionalAuthenticatedRequest): string => {
    if (req.user) {
      return req.user.sub;
    }
    
    const guestCartIdHeader = req.headers['x-guest-cart-id'];
    if (guestCartIdHeader !== undefined) {
      if (typeof guestCartIdHeader === 'string'
        && isGuestCartId(guestCartIdHeader)
        && isValidGuestCartId(guestCartIdHeader)) {
        return guestCartIdHeader;
      }
      throw new Error(CartError.GUEST_CART_ID_INVALID);
    }

    return generateGuestCartId();
  };

  // Helper to check if request is from guest
  const isGuestRequest = (req: OptionalAuthenticatedRequest): boolean => {
    return !req.user;
  };

  // Helper to add guest cart ID to response
  const addGuestCartHeader = (req: OptionalAuthenticatedRequest, res: Response, cartId: string): void => {
    if (isGuestRequest(req)) {
      res.setHeader('X-Guest-Cart-Id', cartId);
    }
  };

  // GET /cart - Get current cart (works for both auth and guest)
  router.get('/', optionalAuthMw as RequestHandler, (async (req: OptionalAuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const cartId = getCartId(req);
      const isGuest = isGuestRequest(req);
      const cart = await cartService.getCart(cartId);
      
      const response: any = { cart: cartToResponse(cart) };
      if (isGuest) {
        response.guestCartId = cartId;
      }
      addGuestCartHeader(req, res, cartId);
      
      return res.json(response);
    } catch (error) {
      if (error instanceof Error && error.message === CartError.GUEST_CART_ID_INVALID) {
        return res.status(400).json({ error: CartError.GUEST_CART_ID_INVALID, message: 'Invalid guest cart ID format' });
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /cart/items - Add item to cart (works for both auth and guest)
  router.post('/items', optionalAuthMw as RequestHandler, (async (req: OptionalAuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { productId, quantity } = req.body;

      if (!productId || typeof productId !== 'string' || productId.trim().length === 0) {
        return res.status(400).json({ error: 'PRODUCT_ID_REQUIRED', message: 'Product ID is required' });
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ error: CartError.INVALID_QUANTITY, message: 'Quantity must be a positive integer' });
      }

      const cartId = getCartId(req);
      const isGuest = isGuestRequest(req);
      const cart = await cartService.addItem(cartId, productId, quantity);

      const response: any = { cart: cartToResponse(cart) };
      if (isGuest) {
        response.guestCartId = cartId;
      }
      addGuestCartHeader(req, res, cartId);

      return res.status(201).json(response);
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
          case CartError.PRODUCT_NOT_AVAILABLE:
            return res.status(409).json({ error: CartError.PRODUCT_NOT_AVAILABLE, message: 'Product is not available' });
          case 'CONSUMER_ID_REQUIRED':
            return res.status(400).json({ error: 'CONSUMER_ID_REQUIRED', message: 'Consumer ID is required' });
          case 'INVALID_UNIT_PRICE':
            return res.status(400).json({ error: 'INVALID_UNIT_PRICE', message: 'Invalid unit price' });
          case CartError.GUEST_CART_ID_INVALID:
            return res.status(400).json({ error: CartError.GUEST_CART_ID_INVALID, message: 'Invalid guest cart ID format' });
          case CartError.CART_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_NOT_FOUND, message: 'Cart not found' });
          case CartError.CART_ITEM_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_ITEM_NOT_FOUND, message: 'Cart item not found' });
          default:
            return res.status(400).json({ error: 'UNHANDLED_ERROR', message: 'An error occurred processing the cart operation' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /cart/items/:productId - Update item quantity (works for both auth and guest)
  router.patch('/items/:productId', optionalAuthMw as RequestHandler, (async (req: OptionalAuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
      const { quantity } = req.body;

      if (!productId || productId.trim().length === 0) {
        return res.status(400).json({ error: 'PRODUCT_ID_REQUIRED', message: 'Product ID is required' });
      }

      if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ error: CartError.INVALID_QUANTITY, message: 'Quantity must be a non-negative integer' });
      }

      const cartId = getCartId(req);
      const isGuest = isGuestRequest(req);
      const cart = await cartService.updateItemQuantity(cartId, productId, quantity);

      const response: any = { cart: cartToResponse(cart) };
      if (isGuest) {
        response.guestCartId = cartId;
      }
      addGuestCartHeader(req, res, cartId);

      return res.json(response);
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case CartError.INVALID_QUANTITY:
            return res.status(400).json({ error: CartError.INVALID_QUANTITY, message: 'Quantity must be a non-negative integer' });
          case CartError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: CartError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case CartError.STOCK_INSUFFICIENT:
            return res.status(409).json({ error: CartError.STOCK_INSUFFICIENT, message: 'Insufficient stock' });
          case CartError.PRODUCT_NOT_AVAILABLE:
            return res.status(409).json({ error: CartError.PRODUCT_NOT_AVAILABLE, message: 'Product is not available' });
          case CartError.CART_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_NOT_FOUND, message: 'Cart not found' });
          case CartError.CART_ITEM_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_ITEM_NOT_FOUND, message: 'Cart item not found' });
          case CartError.GUEST_CART_ID_INVALID:
            return res.status(400).json({ error: CartError.GUEST_CART_ID_INVALID, message: 'Invalid guest cart ID format' });
          default:
            return res.status(400).json({ error: 'UNHANDLED_ERROR', message: 'An error occurred processing the cart operation' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // DELETE /cart/items/:productId - Remove item from cart (works for both auth and guest)
  router.delete('/items/:productId', optionalAuthMw as RequestHandler, (async (req: OptionalAuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;

      if (!productId || productId.trim().length === 0) {
        return res.status(400).json({ error: 'PRODUCT_ID_REQUIRED', message: 'Product ID is required' });
      }

      const cartId = getCartId(req);
      const isGuest = isGuestRequest(req);
      const cart = await cartService.removeItem(cartId, productId);

      const response: any = { cart: cartToResponse(cart) };
      if (isGuest) {
        response.guestCartId = cartId;
      }
      addGuestCartHeader(req, res, cartId);

      return res.json(response);
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case CartError.CART_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_NOT_FOUND, message: 'Cart not found' });
          case CartError.CART_ITEM_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_ITEM_NOT_FOUND, message: 'Cart item not found' });
          case CartError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: CartError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case CartError.GUEST_CART_ID_INVALID:
            return res.status(400).json({ error: CartError.GUEST_CART_ID_INVALID, message: 'Invalid guest cart ID format' });
          case 'INVALID_QUANTITY':
            return res.status(400).json({ error: 'INVALID_QUANTITY', message: 'Quantity must be a non-negative integer' });
          case CartError.STOCK_INSUFFICIENT:
            return res.status(409).json({ error: CartError.STOCK_INSUFFICIENT, message: 'Insufficient stock' });
          case CartError.PRODUCT_NOT_AVAILABLE:
            return res.status(409).json({ error: CartError.PRODUCT_NOT_AVAILABLE, message: 'Product is not available' });
          default:
            return res.status(400).json({ error: 'UNHANDLED_ERROR', message: 'An error occurred processing the cart operation' });
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

      if (!isGuestCartId(guestCartId) || !isValidGuestCartId(guestCartId)) {
        return res.status(400).json({ error: CartError.GUEST_CART_ID_INVALID, message: 'Invalid guest cart ID format' });
      }

      const consumerId = req.user.sub;
      const cart = await cartService.mergeGuestCart(guestCartId, consumerId);

      return res.json({ cart: cartToResponse(cart) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case CartError.CART_NOT_FOUND:
            return res.status(404).json({ error: CartError.CART_NOT_FOUND, message: 'Cart not found' });
          case 'CONSUMER_ID_REQUIRED':
            return res.status(400).json({ error: 'CONSUMER_ID_REQUIRED', message: 'Consumer ID is required' });
          case CartError.GUEST_CART_ID_INVALID:
            return res.status(400).json({ error: CartError.GUEST_CART_ID_INVALID, message: 'Invalid guest cart ID format' });
          case CartError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: CartError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case CartError.PRODUCT_NOT_AVAILABLE:
            return res.status(409).json({ error: CartError.PRODUCT_NOT_AVAILABLE, message: 'Product is not available' });
          case CartError.STOCK_INSUFFICIENT:
            return res.status(409).json({ error: CartError.STOCK_INSUFFICIENT, message: 'Insufficient stock' });
          default:
            return res.status(400).json({ error: 'UNHANDLED_ERROR', message: 'An error occurred processing the cart operation' });
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