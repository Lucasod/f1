import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { OrderService } from './order.service';
import { PersonRepository } from '../person/person.domain';
import { VendorRepository } from '../vendor/vendor.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import { Order, OrderVendorGroup, OrderStatus, OrderVendorGroupStatus, OrderError, DisputeStatus, DisputeResolution, Dispute } from './order.domain';

export interface OrderRoutesConfig {
  authService: AuthService;
  orderService: OrderService;
  personRepo: PersonRepository;
  vendorRepo: VendorRepository;
}

export function createOrderRoutes({ authService, orderService, personRepo, vendorRepo }: OrderRoutesConfig): Router {
  const router = Router();

  const authMw = authMiddleware(authService);
  const requireConsumer = requireRole(PersonRole.CONSUMER);
  const requireConsumerVendorAdmin = requireRole(PersonRole.CONSUMER, PersonRole.VENDOR, PersonRole.ADMIN);
  const requireVendorAdmin = requireRole(PersonRole.VENDOR, PersonRole.ADMIN);
  const requireAdmin = requireRole(PersonRole.ADMIN);
  const requireVendor = requireRole(PersonRole.VENDOR);

  // GET /orders - List orders (auth required)
  // Consumer: returns their orders
  // Vendor: returns orders with their vendor groups (requires vendor profile)
  // Admin: returns all orders
  router.get('/orders', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      const { status, page, limit } = req.query;

      let vendorId: string | undefined;
      let role: 'consumer' | 'vendor' | 'admin' = 'consumer';

      if (req.user.roles.includes(PersonRole.ADMIN)) {
        role = 'admin';
      } else if (req.user.roles.includes(PersonRole.CONSUMER)) {
        role = 'consumer';
      } else if (req.user.roles.includes(PersonRole.VENDOR)) {
        role = 'vendor';
        // Get vendor ID from person's vendor profile
        const vendor = await vendorRepo.findByPersonId(personId);
        if (!vendor) {
          return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor profile not found' });
        }
        vendorId = vendor.id;
      }

      if (role === 'vendor' && status !== undefined) {
        return res.status(400).json({ error: 'VENDOR_ORDER_STATUS_FILTER_UNAVAILABLE', message: 'Global order status filter is unavailable for vendors' });
      }

      const result = await orderService.listOrders(personId, {
        status: status as OrderStatus | undefined,
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        role,
        vendorId
      });

      return res.json({
        orders: result.orders.map(order => vendorId ? vendorOrderToResponse(order, vendorId) : orderToResponse(order)),
        total: result.total,
        page: result.page,
        limit: result.limit
      });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.VENDOR_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.VENDOR_ID_REQUIRED, message: 'Vendor ID is required' });
          case OrderError.PERSON_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.PERSON_ID_REQUIRED, message: 'Person ID is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  router.get('/orders/summary', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const summary = await orderService.getConsumerSummary(req.user.sub);
      return res.json({
        summary: {
          ...summary,
          recentOrders: summary.recentOrders.map(order => orderToResponse(order)),
        },
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // GET /orders/:orderId - Get order details (auth required)
  // Authorization: consumer owns order, vendor owns vendor group in order, admin any
  router.get('/orders/:orderId', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const personId = req.user.sub;

      if (!orderId || orderId.trim().length === 0) {
        return res.status(400).json({ error: 'ORDER_ID_REQUIRED', message: 'Order ID is required' });
      }

      let order: Order | null = null;
      let responseVendorId: string | undefined;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);
      const isConsumer = req.user.roles.includes(PersonRole.CONSUMER);
      const isVendor = req.user.roles.includes(PersonRole.VENDOR);

      if (isAdmin) {
        order = await orderService.getOrderById(orderId, personId, 'admin');
      } else {
        if (isConsumer) {
          order = await orderService.getOrderById(orderId, personId, 'consumer');
        }

        if (!order && isVendor) {
          const vendor = await vendorRepo.findByPersonId(personId);
          if (!vendor && !isConsumer) {
            return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor profile not found' });
          }
          if (vendor) {
            order = await orderService.getOrderById(orderId, personId, 'vendor', vendor.id);
            if (order) responseVendorId = vendor.id;
          }
        }
      }

      if (!order) {
        // Always return 404 to prevent order enumeration
        return res.status(404).json({ error: OrderError.ORDER_NOT_FOUND, message: 'Order not found' });
      }

      if (responseVendorId !== undefined) {
        return res.json({ order: vendorOrderToResponse(order, responseVendorId) });
      }
      return res.json({ order: orderToResponse(order) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.VENDOR_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.VENDOR_ID_REQUIRED, message: 'Vendor ID is required' });
          case OrderError.PERSON_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.PERSON_ID_REQUIRED, message: 'Person ID is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /orders/:orderId/vendor-groups/:ovgId/status - Update vendor group status (auth required)
  // Body: { status: OrderVendorGroupStatus }
  // Vendor: can only update their own vendor groups
  // Admin: can update any vendor group
  router.patch('/orders/:orderId/vendor-groups/:ovgId/status', authMw as RequestHandler, requireVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const vendorGroupId = Array.isArray(req.params.ovgId) ? req.params.ovgId[0] : req.params.ovgId;
      const { status } = req.body;
      const personId = req.user.sub;

      if (!orderId || orderId.trim().length === 0) {
        return res.status(400).json({ error: 'ORDER_ID_REQUIRED', message: 'Order ID is required' });
      }
      if (!vendorGroupId || vendorGroupId.trim().length === 0) {
        return res.status(400).json({ error: 'VENDOR_GROUP_ID_REQUIRED', message: 'Vendor group ID is required' });
      }
      if (!status || !Object.values(OrderVendorGroupStatus).includes(status as OrderVendorGroupStatus)) {
        return res.status(400).json({ error: 'INVALID_STATUS', message: 'Invalid vendor group status' });
      }

      let actorRole: 'vendor' | 'admin' = 'vendor';
      let actorId = personId;

      if (req.user.roles.includes(PersonRole.ADMIN)) {
        actorRole = 'admin';
      } else if (req.user.roles.includes(PersonRole.VENDOR)) {
        const vendor = await vendorRepo.findByPersonId(personId);
        if (!vendor) {
          return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor profile not found' });
        }
        actorId = vendor.id;
      }

      const order = await orderService.updateVendorGroupStatus(
        orderId,
        vendorGroupId,
        status as OrderVendorGroupStatus,
        actorRole,
        actorId
      );

      const responseVendorId = actorRole === 'vendor' ? actorId : undefined;
      return res.json({ order: responseVendorId ? vendorOrderToResponse(order, responseVendorId) : orderToResponse(order) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.ORDER_NOT_FOUND:
            return res.status(404).json({ error: OrderError.ORDER_NOT_FOUND, message: 'Order not found' });
          case OrderError.VENDOR_NOT_FOUND:
            return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor group not found' });
           case OrderError.INVALID_STATUS_TRANSITION:
             return res.status(409).json({ error: OrderError.INVALID_STATUS_TRANSITION, message: 'Invalid status transition' });
           case OrderError.FORBIDDEN:
             return res.status(403).json({ error: OrderError.FORBIDDEN, message: 'Access denied' });
           case OrderError.VENDOR_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.VENDOR_ID_REQUIRED, message: 'Vendor ID is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /orders/:orderId/status - Update order status (auth required, ADMIN only)
  // Body: { status: OrderStatus }
  router.patch('/orders/:orderId/status', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const { status } = req.body;

      if (!orderId || orderId.trim().length === 0) {
        return res.status(400).json({ error: 'ORDER_ID_REQUIRED', message: 'Order ID is required' });
      }
      if (!status || !Object.values(OrderStatus).includes(status as OrderStatus)) {
        return res.status(400).json({ error: 'INVALID_STATUS', message: 'Invalid order status' });
      }

      const order = await orderService.updateOrderStatus(orderId, status as OrderStatus);

      return res.json({ order: orderToResponse(order) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.ORDER_NOT_FOUND:
            return res.status(404).json({ error: OrderError.ORDER_NOT_FOUND, message: 'Order not found' });
          case OrderError.INVALID_STATUS_TRANSITION:
            return res.status(409).json({ error: OrderError.INVALID_STATUS_TRANSITION, message: 'Invalid status transition' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // GET /vendor/orders - Get vendor's order groups (auth required, VENDOR role)
  // Query params: status?, page?, limit?
  router.get('/vendor/orders', authMw as RequestHandler, requireVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      const { status, page, limit } = req.query;

      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor) {
        return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor profile not found' });
      }

      const result = await orderService.getOrdersByVendor(vendor.id, {
        status: status as OrderVendorGroupStatus | undefined,
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined
      });

      return res.json({
        vendorGroups: vendorGroupsToResponse(result.vendorGroups),
        total: result.total,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 20
      });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.VENDOR_NOT_FOUND:
            return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);


  // POST /orders/:orderId/comment - Comment feature disabled
  router.post('/orders/:orderId/comment', authMw as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    return res.status(404).json({ error: 'COMMENT_FEATURE_DISABLED', message: 'Comment feature is disabled' });
  }) as RequestHandler);

  // PATCH /orders/:orderId/items/delivery - Mark order items as delivered (item-level delivery)
  // Body: { itemIds?: string[], all?: boolean }
  // Vendor: own items only; Consumer: confirm delivery; Admin: any
  router.patch('/orders/:orderId/items/delivery', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const personId = req.user.sub;
      const { itemIds, all } = req.body ?? {};

      if (!orderId || orderId.trim().length === 0) {
        return res.status(400).json({ error: 'ORDER_ID_REQUIRED', message: 'Order ID is required' });
      }

      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);
      const isConsumer = req.user.roles.includes(PersonRole.CONSUMER);
      const isVendor = req.user.roles.includes(PersonRole.VENDOR);

      let role: 'consumer' | 'vendor' | 'admin' = 'consumer';
      let vendorId: string | undefined;

      if (isAdmin) {
        role = 'admin';
      } else if (isConsumer && isVendor) {
        const probe = await orderService.getOrderById(orderId, personId, 'admin');
        if (probe && probe.personId === personId) {
          role = 'consumer';
        } else {
          const vendor = await vendorRepo.findByPersonId(personId);
          if (!vendor) {
            return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor profile not found' });
          }
          vendorId = vendor.id;
          role = 'vendor';
        }
      } else if (isVendor) {
        role = 'vendor';
        const vendor = await vendorRepo.findByPersonId(personId);
        if (!vendor) {
          return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor profile not found' });
        }
        vendorId = vendor.id;
      } else {
        role = 'consumer';
      }

      const order = await orderService.markItemsDelivered(
        orderId,
        personId,
        role,
        vendorId,
        Array.isArray(itemIds) ? itemIds : undefined,
        all === true
      );

      if (role === 'vendor') {
        return res.json({ order: vendorOrderToResponse(order, vendorId!) });
      }
      return res.json({ order: orderToResponse(order) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.ORDER_NOT_FOUND:
            return res.status(404).json({ error: OrderError.ORDER_NOT_FOUND, message: 'Order not found' });
          case OrderError.ORDER_ITEM_NOT_FOUND:
            return res.status(404).json({ error: OrderError.ORDER_ITEM_NOT_FOUND, message: 'Order item not found' });
          case OrderError.FORBIDDEN:
            return res.status(403).json({ error: OrderError.FORBIDDEN, message: 'Access denied' });
          case OrderError.VENDOR_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.VENDOR_ID_REQUIRED, message: 'Vendor ID is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /orders/:orderId/items/:itemId/disputes - Initiate a dispute on a delivered order item
  // Body: { description: string }
  // Consumer: can only dispute their own delivered order items
  router.post('/orders/:orderId/items/:itemId/disputes', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
      const { description } = req.body ?? {};
      const personId = req.user.sub;

      if (!orderId || orderId.trim().length === 0) {
        return res.status(400).json({ error: 'ORDER_ID_REQUIRED', message: 'Order ID is required' });
      }
      if (!itemId || itemId.trim().length === 0) {
        return res.status(400).json({ error: 'ORDER_ITEM_ID_REQUIRED', message: 'Order item ID is required' });
      }
      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return res.status(400).json({ error: 'INVALID_COMMENT', message: 'Description is required' });
      }

      const dispute = await orderService.initiateDispute(itemId, description.trim(), 'consumer', personId);
      return res.status(201).json({ dispute: disputeToResponse(dispute) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.ORDER_NOT_FOUND:
          case OrderError.ORDER_ITEM_NOT_FOUND:
            return res.status(404).json({ error: error.message, message: 'Order or order item not found' });
          case OrderError.ORDER_NOT_DELIVERED:
            return res.status(422).json({ error: OrderError.ORDER_NOT_DELIVERED, message: 'Order item is not delivered' });
          case OrderError.FORBIDDEN:
            return res.status(403).json({ error: OrderError.FORBIDDEN, message: 'Access denied' });
          case OrderError.REVIEW_ALREADY_EXISTS:
          case OrderError.REVIEW_CONFLICT:
            return res.status(409).json({ error: error.message, message: error.message });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /disputes/:disputeId/approve - Vendor approves a dispute
  router.post('/disputes/:disputeId/approve', authMw as RequestHandler, requireVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const disputeId = Array.isArray(req.params.disputeId) ? req.params.disputeId[0] : req.params.disputeId;
      const personId = req.user.sub;

      if (!disputeId || disputeId.trim().length === 0) {
        return res.status(400).json({ error: 'DISPUTE_ID_REQUIRED', message: 'Dispute ID is required' });
      }

      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor) {
        return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor profile not found' });
      }

      const dispute = await orderService.approveDispute(disputeId, vendor.id);
      return res.json({ dispute: disputeToResponse(dispute) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.DISPUTE_NOT_FOUND:
            return res.status(404).json({ error: OrderError.DISPUTE_NOT_FOUND, message: 'Dispute not found' });
          case OrderError.DISPUTE_NOT_PENDING:
          case OrderError.DISPUTE_ALREADY_RESOLVED:
            return res.status(409).json({ error: error.message, message: error.message });
          case OrderError.FORBIDDEN:
            return res.status(403).json({ error: OrderError.FORBIDDEN, message: 'Access denied' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /disputes/:disputeId/reject - Vendor rejects a dispute
  router.post('/disputes/:disputeId/reject', authMw as RequestHandler, requireVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const disputeId = Array.isArray(req.params.disputeId) ? req.params.disputeId[0] : req.params.disputeId;
      const personId = req.user.sub;

      if (!disputeId || disputeId.trim().length === 0) {
        return res.status(400).json({ error: 'DISPUTE_ID_REQUIRED', message: 'Dispute ID is required' });
      }

      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor) {
        return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor profile not found' });
      }

      const dispute = await orderService.rejectDispute(disputeId, vendor.id);
      return res.json({ dispute: disputeToResponse(dispute) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.DISPUTE_NOT_FOUND:
            return res.status(404).json({ error: OrderError.DISPUTE_NOT_FOUND, message: 'Dispute not found' });
          case OrderError.DISPUTE_NOT_PENDING:
          case OrderError.DISPUTE_ALREADY_RESOLVED:
            return res.status(409).json({ error: error.message, message: error.message });
          case OrderError.FORBIDDEN:
            return res.status(403).json({ error: OrderError.FORBIDDEN, message: 'Access denied' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /disputes/:disputeId/admin-mediate - Admin mediates a dispute
  // Body: { resolution: 'approved' | 'rejected' | 'mediated' }
  router.post('/disputes/:disputeId/admin-mediate', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const disputeId = Array.isArray(req.params.disputeId) ? req.params.disputeId[0] : req.params.disputeId;
      const { resolution } = req.body ?? {};

      if (!disputeId || disputeId.trim().length === 0) {
        return res.status(400).json({ error: 'DISPUTE_ID_REQUIRED', message: 'Dispute ID is required' });
      }
      if (!resolution || !Object.values(DisputeResolution).includes(resolution as DisputeResolution)) {
        return res.status(400).json({ error: 'INVALID_RESOLUTION', message: 'Invalid resolution' });
      }

      const dispute = await orderService.adminMediateDispute(disputeId, resolution as DisputeResolution);
      return res.json({ dispute: disputeToResponse(dispute) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.DISPUTE_NOT_FOUND:
            return res.status(404).json({ error: OrderError.DISPUTE_NOT_FOUND, message: 'Dispute not found' });
          case OrderError.DISPUTE_NOT_PENDING:
          case OrderError.DISPUTE_ALREADY_RESOLVED:
            return res.status(409).json({ error: error.message, message: error.message });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}

function orderToResponse(order: Order, vendorId?: string) {
  return {
    id: order.id,
    personId: order.personId,
    status: order.status,
    vendorGroups: order.vendorGroups
      .map(vg => vendorGroupToResponse(vg))
      .filter(vg => vendorId === undefined || vg.vendorId === vendorId),
    shippingAddress: order.shippingAddress,
    totalAmount: order.totalAmount,
    financialStatus: order.financialStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    
  };
}

function vendorOrderToResponse(order: Order, vendorId: string) {
  const { status: _status, financialStatus: _financialStatus, ...scoped } = orderToResponse(order, vendorId);
  return { ...scoped, totalAmount: scoped.vendorGroups.reduce((sum, group) => sum + group.subtotal, 0) };
}

function vendorGroupToResponse(vg: OrderVendorGroup) {
  return {
    id: vg.id,
    orderId: vg.orderId,
    vendorId: vg.vendorId,
    status: vg.status,
    items: vg.items.map(item => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      vendorId: item.vendorId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      deliveredAt: item.deliveredAt,
      deliveredBy: item.deliveredBy
    })),
    subtotal: vg.subtotal,
    commissionPct: vg.commissionPct,
    commissionAmount: vg.commissionAmount,
    vendorNet: vg.vendorNet,
    transferId: vg.transferId,
    createdAt: vg.createdAt,
    updatedAt: vg.updatedAt
  };
}

function vendorGroupsToResponse(vgs: OrderVendorGroup[]) {
  return vgs.map(vendorGroupToResponse);
}

function disputeToResponse(dispute: Dispute) {
  return {
    id: dispute.id,
    status: dispute.status,
    type: dispute.type,
    requestedBy: dispute.requestedBy,
    orderItemId: dispute.orderItemId,
    description: dispute.description,
    resolution: dispute.resolution,
    resolvedAt: dispute.resolvedAt,
    resolvedBy: dispute.resolvedBy,
    createdAt: dispute.createdAt,
  };
}
