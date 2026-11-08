import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { InvoiceService } from './invoice.service';
import { Invoice, InvoiceError, InvoiceStatus } from './invoice.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import { Order, OrderRepository } from '../order/order.domain';
import { VendorRepository } from '../vendor/vendor.domain';

export interface InvoiceRoutesConfig {
  authService: AuthService;
  invoiceService: InvoiceService;
  orderRepo: OrderRepository;
  vendorRepo: VendorRepository;
}

export function createInvoiceRoutes({ authService, invoiceService, orderRepo, vendorRepo }: InvoiceRoutesConfig): Router {
  const router = Router();
  const authMw = authMiddleware(authService);
  const requireAdmin = requireRole(PersonRole.ADMIN);

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  function invoiceToResponse(invoice: Invoice, access: 'full' | 'vendor' = 'full') {
    return {
      id: invoice.id,
      orderId: invoice.orderId,
      vendorId: invoice.vendorId,
      emissionAt: invoice.emissionAt,
      // Vendors must use the authenticated download gate, never a raw storage link.
      ...(access === 'full' ? { pdfUrl: invoice.pdfUrl, pdfPath: invoice.pdfPath } : {}),
      status: invoice.status,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }

  function readPathParameter(value: string | string[]): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    return value;
  }

  function parsePagination(req: Request): { page: number; limit: number } {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(page) || !Number.isInteger(limit)) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    return { page, limit };
  }

  async function receiptAccess(req: AuthenticatedRequest, invoice: Invoice, order: Order | null): Promise<'full' | 'vendor' | null> {
    const personId = req.user.sub;
    if (order && order.id !== invoice.orderId) return null;
    if (req.user.roles.includes(PersonRole.ADMIN)) return 'full';
    if (!order || typeof order.personId !== 'string' || !order.personId.trim()) return null;
    if (req.user.roles.includes(PersonRole.CONSUMER) && order.personId === personId) return 'full';
    if (req.user.roles.includes(PersonRole.VENDOR)) {
      const vendor = await vendorRepo.findByPersonId(personId);
      // The existing PDF contains every group and the order total. Its vendorId
      // label alone is not evidence that its contents belong to this store.
      if (vendor?.id && invoice.vendorId === vendor.id &&
          Array.isArray(order.vendorGroups) && order.vendorGroups.length > 0 &&
          order.vendorGroups.every(group => group && group.orderId === order.id && group.vendorId === vendor.id &&
            Array.isArray(group.items) && group.items.length > 0 &&
            group.items.every(item => item && item.vendorId === vendor.id))) return 'vendor';
    }
    return null;
  }

  // GET /invoices - list invoices (admin only)
  router.get('/', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = parsePagination(req);
      const result = await invoiceService.listInvoices(page, limit);
      return res.json({
        invoices: result.invoices.map(invoice => invoiceToResponse(invoice)),
        items: result.items.map(invoice => invoiceToResponse(invoice)),
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (error) {
      return handleInvoiceError(error, res, next);
    }
  }) as RequestHandler);

  // GET /invoices/order/:orderId - get invoice by order
  router.get('/order/:orderId', authMw as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const orderId = readPathParameter(req.params.orderId);
      const order = await orderRepo.findById(orderId);
      if (!order) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      const invoice = await invoiceService.getInvoiceByOrderId(orderId);
      if (!invoice || invoice.orderId !== orderId) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      const access = await receiptAccess(req, invoice, order);
      if (!access) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      return res.json({ invoice: invoiceToResponse(invoice, access) });
    } catch (error) {
      return handleInvoiceError(error, res, next);
    }
  }) as RequestHandler);

  // GET /invoices/:invoiceId - get invoice
  router.get('/:invoiceId', authMw as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const invoiceId = readPathParameter(req.params.invoiceId);
      const invoice = await invoiceService.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      const access = await receiptAccess(req, invoice, await orderRepo.findById(invoice.orderId));
      if (!access) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      return res.json({ invoice: invoiceToResponse(invoice, access) });
    } catch (error) {
      return handleInvoiceError(error, res, next);
    }
  }) as RequestHandler);

  // POST /invoices/:invoiceId/generate - generate/regenerate PDF (admin only)
  router.post('/:invoiceId/generate', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const invoiceId = readPathParameter(req.params.invoiceId);
      const invoice = await invoiceService.regeneratePdf(invoiceId);
      return res.json({ invoice: invoiceToResponse(invoice) });
    } catch (error) {
      return handleInvoiceError(error, res, next);
    }
  }) as RequestHandler);

  // GET /invoices/:invoiceId/download - download PDF (on-demand generation, no permanent storage)
  router.get('/:invoiceId/download', authMw as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const invoiceId = readPathParameter(req.params.invoiceId);
      const invoice = await invoiceService.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      const access = await receiptAccess(req, invoice, await orderRepo.findById(invoice.orderId));
      if (!access) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      if (invoice.status !== InvoiceStatus.GENERATED) {
        return res.status(404).json({ error: 'PDF not yet generated', message: 'PDF not yet generated' });
      }
      const pdfBuffer = await invoiceService.downloadInvoice(invoiceId);
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
      return res.send(pdfBuffer);
    } catch (error) {
      return handleInvoiceError(error, res, next);
    }
  }) as RequestHandler);

  return router;
}

function handleInvoiceError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof Error) {
    switch (error.message) {
      case InvoiceError.INVALID_INVOICE:
      case InvoiceError.ORDER_NOT_ELIGIBLE:
        return res.status(400).json({ error: error.message, message: error.message });
      case InvoiceError.INVOICE_ALREADY_EXISTS:
        return res.status(409).json({ error: error.message, message: 'Invoice already exists for this order' });
      case InvoiceError.INVOICE_NOT_FOUND:
      case InvoiceError.ORDER_NOT_FOUND:
        return res.status(404).json({ error: error.message, message: error.message });
    }
  }
  return next(error);
}
