import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { InvoiceService } from './invoice.service';
import { Invoice, InvoiceError } from './invoice.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';

export interface InvoiceRoutesConfig {
  authService: AuthService;
  invoiceService: InvoiceService;
}

export function createInvoiceRoutes({ authService, invoiceService }: InvoiceRoutesConfig): Router {
  const router = Router();
  const authMw = authMiddleware(authService);
  const requireAdmin = requireRole(PersonRole.ADMIN);

  function invoiceToResponse(invoice: Invoice) {
    return {
      id: invoice.id,
      orderId: invoice.orderId,
      vendorId: invoice.vendorId,
      emissionAt: invoice.emissionAt,
      pdfUrl: invoice.pdfUrl,
      pdfPath: invoice.pdfPath,
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

  // GET /invoices - list invoices
  router.get('/', authMw as RequestHandler, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = parsePagination(req);
      const result = await invoiceService.listInvoices(page, limit);
      return res.json({
        invoices: result.invoices.map(invoiceToResponse),
        items: result.items.map(invoiceToResponse),
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (error) {
      return handleInvoiceError(error, res, next);
    }
  }) as RequestHandler);

  // GET /invoices/order/:orderId - get invoice by order
  router.get('/order/:orderId', authMw as RequestHandler, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orderId = readPathParameter(req.params.orderId);
      const invoice = await invoiceService.getInvoiceByOrderId(orderId);
      if (!invoice) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      return res.json({ invoice: invoiceToResponse(invoice) });
    } catch (error) {
      return handleInvoiceError(error, res, next);
    }
  }) as RequestHandler);

  // GET /invoices/:invoiceId - get invoice
  router.get('/:invoiceId', authMw as RequestHandler, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoiceId = readPathParameter(req.params.invoiceId);
      const invoice = await invoiceService.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      return res.json({ invoice: invoiceToResponse(invoice) });
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

  // GET /invoices/:invoiceId/download - download PDF
  router.get('/:invoiceId/download', authMw as RequestHandler, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoiceId = readPathParameter(req.params.invoiceId);
      const invoice = await invoiceService.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
      }
      return res.json({ pdfUrl: invoice.pdfUrl, url: invoice.pdfUrl });
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
