import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { AuthService } from '../auth/auth.service';
import { ProductService } from './product.service';
import { PersonRepository } from '../person/person.domain';
import { VendorRepository, VendorStatus } from '../vendor/vendor.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import { ProductStatus, VALID_STATUSES, ProductError, ProductRepository } from './product.domain';
import { ReviewService } from '../review/review.service';
import { ReviewStatus } from '../review/review.domain';
import { StorageAdapter } from '../../shared/storage/storage.interface';
import { config } from '../../config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Extend AuthenticatedRequest to include multer's file property
interface MulterAuthenticatedRequest extends AuthenticatedRequest {
  file?: Express.Multer.File;
  files?: Express.Multer.File[];
}

function getQueryString(val: any): string | undefined {
  if (Array.isArray(val)) return val[0];
  if (typeof val === 'string') return val;
  return undefined;
}

function getParam(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

export interface ProductRoutesConfig {
  authService: AuthService;
  productService: ProductService;
  personRepo: PersonRepository;
  vendorRepo: VendorRepository;
  storageAdapter: StorageAdapter;
}

export function createProductRoutes({ authService, productService, personRepo, vendorRepo, storageAdapter }: ProductRoutesConfig): Router {
  const router = Router();

  const authMw = authMiddleware(authService);
  const requireVendor = requireRole(PersonRole.VENDOR);
  const requireVendorOrAdmin = requireRole(PersonRole.VENDOR, PersonRole.ADMIN);
  const requireAdmin = requireRole(PersonRole.ADMIN);

  // Multer configuration for image uploads
  const upload = multer({
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 11, // 1 main + 10 gallery
    },
    fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
      }
    },
  });

  // Support both single 'image' field (backward compat) and multiple 'images' field (gallery)
  const uploadImages = upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: 11 }
  ]);

  // ============ Product Routes ============

  // POST /api/v1/products - Create product (VENDOR role required)
  router.post('/', authMw as RequestHandler, requireVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { categoryId, name, description, price, quantity, images, status } = req.body;

      // Validate required fields
      if (!categoryId || categoryId.trim().length === 0) {
        return res.status(400).json({ error: 'CATEGORY_ID_REQUIRED', message: 'Category ID is required' });
      }
      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'PRODUCT_NAME_REQUIRED', message: 'Product name is required' });
      }
      if (!description || description.trim().length === 0) {
        return res.status(400).json({ error: 'PRODUCT_DESCRIPTION_REQUIRED', message: 'Product description is required' });
      }
      if (typeof price !== 'number' || price < 0) {
        return res.status(400).json({ error: 'PRODUCT_PRICE_INVALID', message: 'Price must be a non-negative number' });
      }
      if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ error: 'PRODUCT_QUANTITY_INVALID', message: 'Quantity must be a non-negative integer' });
      }

      // Get vendor ID from authenticated user
      const personId = req.user.sub;
      const person = await personRepo.findById(personId);
      
      if (!person) {
        return res.status(404).json({ error: 'PERSON_NOT_FOUND', message: 'Person not found' });
      }

      // Find vendor by personId
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      
      // Check vendor status - suspended vendors cannot create products (unless admin)
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);
      if (vendor.status === VendorStatus.SUSPENDED && !isAdmin) {
        return res.status(403).json({ error: 'VENDOR_SUSPENDED', message: 'Suspended vendor cannot perform this action' });
      }
      
      const vendorId = vendor.id;
      
      const product = await productService.createProduct(vendorId, {
        vendorId,
        categoryId,
        name: name.trim(),
        description: description.trim(),
        price,
        quantity,
        images: images || [],
        status
      });

      return res.status(201).json({ product: productToResponse(product) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.PRODUCT_CONFLICT:
            return res.status(409).json({ error: ProductError.PRODUCT_CONFLICT, message: 'Product creation conflict' });
          case ProductError.PRODUCT_VENDOR_REQUIRED:
            return res.status(404).json({ error: ProductError.PRODUCT_VENDOR_REQUIRED, message: 'Vendor profile not found for this user' });
          case ProductError.PRODUCT_CATEGORY_NOT_FOUND:
            return res.status(404).json({ error: ProductError.PRODUCT_CATEGORY_NOT_FOUND, message: 'Category not found' });
          case ProductError.PRODUCT_NAME_REQUIRED:
            return res.status(400).json({ error: ProductError.PRODUCT_NAME_REQUIRED, message: 'Product name is required' });
          case 'DESCRIPTION_REQUIRED':
            return res.status(400).json({ error: 'DESCRIPTION_REQUIRED', message: 'Product description is required' });
          case ProductError.PRODUCT_PRICE_INVALID:
            return res.status(400).json({ error: ProductError.PRODUCT_PRICE_INVALID, message: 'Invalid price' });
          case ProductError.PRODUCT_QUANTITY_INVALID:
            return res.status(400).json({ error: ProductError.PRODUCT_QUANTITY_INVALID, message: 'Invalid quantity' });
          case ProductError.PRODUCT_CATEGORY_REQUIRED:
            return res.status(400).json({ error: ProductError.PRODUCT_CATEGORY_REQUIRED, message: 'Category ID is required' });
          case ProductError.PRODUCT_STATUS_INVALID:
            return res.status(400).json({ error: ProductError.PRODUCT_STATUS_INVALID, message: 'Invalid product status' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // GET /api/v1/products - List products (public, with optional filters)
  router.get('/', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, vendorId, categoryId, search, sortBy, page, limit, catalog } = req.query;
      
      const filters: { status?: string; vendorId?: string; search?: string; sortBy?: string } = {};
      const statusStr = getQueryString(status);
      const vendorIdStr = getQueryString(vendorId);
      const searchStr = getQueryString(search);
      const sortByStr = getQueryString(sortBy);
      if (searchStr?.includes('\0')) {
        return res.status(400).json({ error: 'INVALID_SEARCH', message: 'Search must not contain NUL characters' });
      }
      if (statusStr) filters.status = statusStr;
      if (vendorIdStr) filters.vendorId = vendorIdStr;
      if (searchStr) filters.search = searchStr;
      if (sortByStr) filters.sortBy = sortByStr;
      
      const products = await productService.listProducts(filters);
      
      // Filter before pagination, retaining the repository's product order.
      let filteredProducts = getQueryString(catalog) === 'true'
        ? products.filter(product => product.status === ProductStatus.ACTIVE || product.status === ProductStatus.OUT_OF_STOCK)
        : products;
      const categoryIdStr = getQueryString(categoryId);
      if (categoryIdStr) {
        const categories = await productService.listCategories();
        const childrenByParent = new Map<string, string[]>();
        for (const category of categories) {
          if (category.parentId !== null) {
            const children = childrenByParent.get(category.parentId) ?? [];
            children.push(category.id);
            childrenByParent.set(category.parentId, children);
          }
        }
        const categoryIds = new Set([categoryIdStr]);
        const pending = [categoryIdStr];
        while (pending.length > 0) {
          for (const childId of childrenByParent.get(pending.pop()!) ?? []) {
            if (!categoryIds.has(childId)) {
              categoryIds.add(childId);
              pending.push(childId);
            }
          }
        }
        filteredProducts = filteredProducts.filter(p => categoryIds.has(p.categoryId));
      }

      // Pagination
      const pageStr = getQueryString(page);
      const limitStr = getQueryString(limit);
      const pageNum = pageStr ? parseInt(pageStr, 10) : 1;
      const limitNum = limitStr ? parseInt(limitStr, 10) : 20;
      const start = (pageNum - 1) * limitNum;
      const end = start + limitNum;
      const paginatedProducts = filteredProducts.slice(start, end);

      return res.json({
        products: paginatedProducts.map(productToResponse),
        total: filteredProducts.length,
        page: pageNum,
        limit: limitNum
      });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // GET /api/v1/products/:productId - Get product by ID (public)
  router.get('/:productId', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = getParam(req.params.productId);
      const product = await productService.getProductById(productId);

      if (!product) {
        return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
      }

      return res.json({ product: productToResponse(product) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // GET /api/v1/products/vendor/me - Get authenticated vendor's products (VENDOR role)
  router.get('/vendor/me', authMw as RequestHandler, requireVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      const person = await personRepo.findById(personId);
      
      if (!person) {
        return res.status(404).json({ error: 'PERSON_NOT_FOUND', message: 'Person not found' });
      }

      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      const vendorId = vendor.id;
      const products = await productService.getProductsByVendor(vendorId);

      return res.json({ products: products.map(productToResponse) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/products/:productId - Update product (VENDOR role, ownership check; ADMIN can manage all)
  router.patch('/:productId', authMw as RequestHandler, requireVendorOrAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = getParam(req.params.productId);
      const { name, description, price, quantity, categoryId, images, status } = req.body;

      // Validate fields if provided
      if (name !== undefined && (!name || name.trim().length === 0)) {
        return res.status(400).json({ error: 'PRODUCT_NAME_REQUIRED', message: 'Product name cannot be empty' });
      }
      if (description !== undefined && (!description || description.trim().length === 0)) {
        return res.status(400).json({ error: 'PRODUCT_DESCRIPTION_REQUIRED', message: 'Product description cannot be empty' });
      }
      if (price !== undefined && (typeof price !== 'number' || price < 0)) {
        return res.status(400).json({ error: 'PRODUCT_PRICE_INVALID', message: 'Price must be a non-negative number' });
      }
      if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 0)) {
        return res.status(400).json({ error: 'PRODUCT_QUANTITY_INVALID', message: 'Quantity must be a non-negative integer' });
      }
      if (status !== undefined && !VALID_STATUSES.includes(status as ProductStatus)) {
        return res.status(400).json({ error: 'PRODUCT_STATUS_INVALID', message: 'Invalid product status' });
      }

      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);

      // Resolve vendor ID from person ID
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor && !isAdmin) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      
      // Check vendor status - suspended vendors cannot update products (unless admin)
      if (vendor && vendor.status === VendorStatus.SUSPENDED && !isAdmin) {
        return res.status(403).json({ error: 'VENDOR_SUSPENDED', message: 'Suspended vendor cannot perform this action' });
      }
      
      const vendorId = vendor?.id || personId; // Admin can use personId for cross-vendor operations

      const updated = await productService.updateProduct(productId, vendorId, {
        name: name?.trim(),
        description: description?.trim(),
        price,
        quantity,
        categoryId,
        images,
        status
      }, isAdmin);

      return res.json({ product: productToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case ProductError.PRODUCT_OWNERSHIP_VIOLATION:
            return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
          case ProductError.PRODUCT_CATEGORY_NOT_FOUND:
            return res.status(404).json({ error: ProductError.PRODUCT_CATEGORY_NOT_FOUND, message: 'Category not found' });
          case ProductError.PRODUCT_STATUS_INVALID:
            return res.status(400).json({ error: ProductError.PRODUCT_STATUS_INVALID, message: 'Invalid product status' });
          case ProductError.PRODUCT_NAME_REQUIRED:
            return res.status(400).json({ error: ProductError.PRODUCT_NAME_REQUIRED, message: 'Product name is required' });
          case 'DESCRIPTION_REQUIRED':
            return res.status(400).json({ error: 'DESCRIPTION_REQUIRED', message: 'Product description is required' });
          case ProductError.PRODUCT_PRICE_INVALID:
            return res.status(400).json({ error: ProductError.PRODUCT_PRICE_INVALID, message: 'Invalid price' });
          case ProductError.PRODUCT_QUANTITY_INVALID:
            return res.status(400).json({ error: ProductError.PRODUCT_QUANTITY_INVALID, message: 'Invalid quantity' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // DELETE /api/v1/products/:productId - Delete product (VENDOR role, ownership check; ADMIN can manage all)
  router.delete('/:productId', authMw as RequestHandler, requireVendorOrAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = getParam(req.params.productId);
      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);

      // Resolve vendor ID from person ID
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor && !isAdmin) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      
      // Check vendor status - suspended vendors cannot delete products (unless admin)
      if (vendor && vendor.status === VendorStatus.SUSPENDED && !isAdmin) {
        return res.status(403).json({ error: 'VENDOR_SUSPENDED', message: 'Suspended vendor cannot perform this action' });
      }
      
      const vendorId = vendor?.id || personId; // Admin can use personId for cross-vendor operations

      await productService.deleteProduct(productId, vendorId, isAdmin);

      return res.status(204).send();
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case ProductError.PRODUCT_OWNERSHIP_VIOLATION:
            return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/products/:productId/stock - Update product stock (VENDOR role, ownership check; ADMIN can manage all)
  router.patch('/:productId/stock', authMw as RequestHandler, requireVendorOrAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = getParam(req.params.productId);
      const { quantity } = req.body;

      if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ error: 'PRODUCT_QUANTITY_INVALID', message: 'Quantity must be a non-negative integer' });
      }

      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);

      // Resolve vendor ID from person ID
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor && !isAdmin) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      
      // Check vendor status - suspended vendors cannot update stock (unless admin)
      if (vendor && vendor.status === VendorStatus.SUSPENDED && !isAdmin) {
        return res.status(403).json({ error: 'VENDOR_SUSPENDED', message: 'Suspended vendor cannot perform this action' });
      }
      
      const vendorId = vendor?.id || personId; // Admin can use personId for cross-vendor operations

      const updated = await productService.updateProductStock(productId, vendorId, quantity, isAdmin);

      return res.json({ product: productToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case ProductError.PRODUCT_OWNERSHIP_VIOLATION:
            return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
          case ProductError.PRODUCT_QUANTITY_INVALID:
            return res.status(400).json({ error: ProductError.PRODUCT_QUANTITY_INVALID, message: 'Invalid quantity' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/products/:productId/inactivate - Inactivate product (VENDOR role, ownership check; ADMIN can manage all)
  router.patch('/:productId/inactivate', authMw as RequestHandler, requireVendorOrAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = getParam(req.params.productId);
      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);

      // Resolve vendor ID from person ID
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor && !isAdmin) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      
      // Check vendor status - suspended vendors cannot inactivate products (unless admin)
      if (vendor && vendor.status === VendorStatus.SUSPENDED && !isAdmin) {
        return res.status(403).json({ error: 'VENDOR_SUSPENDED', message: 'Suspended vendor cannot perform this action' });
      }
      
      const vendorId = vendor?.id || personId; // Admin can use personId for cross-vendor operations

      const updated = await productService.inactivateProduct(productId, vendorId, isAdmin);

      return res.json({ product: productToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case ProductError.PRODUCT_OWNERSHIP_VIOLATION:
            return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/products/:productId/activate - Activate product (VENDOR role, ownership check; ADMIN can manage all)
  router.patch('/:productId/activate', authMw as RequestHandler, requireVendorOrAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = getParam(req.params.productId);
      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);

      // Resolve vendor ID from person ID
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor && !isAdmin) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      
      // Check vendor status - suspended vendors cannot activate products (unless admin)
      if (vendor && vendor.status === VendorStatus.SUSPENDED && !isAdmin) {
        return res.status(403).json({ error: 'VENDOR_SUSPENDED', message: 'Suspended vendor cannot perform this action' });
      }
      
      const vendorId = vendor?.id || personId; // Admin can use personId for cross-vendor operations

      const updated = await productService.activateProduct(productId, vendorId, isAdmin);

      return res.json({ product: productToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case ProductError.PRODUCT_OWNERSHIP_VIOLATION:
            return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /api/v1/products/:productId/images - Upload product image(s) (VENDOR role, ownership check)
  // Supports both single image (field: 'image') and multiple images (field: 'images') for gallery
  router.post('/:productId/images', authMw as RequestHandler, requireVendorOrAdmin as RequestHandler, uploadImages, (async (req: MulterAuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = getParam(req.params.productId);
      
      // upload.fields() returns files as { fieldName: File[] }
      const filesObj = req.files as { [fieldName: string]: Express.Multer.File[] } | undefined;
      const files = filesObj?.images;
      const singleFile = filesObj?.image?.[0] || req.file;
      
      if ((!files || files.length === 0) && !singleFile) {
        return res.status(400).json({ error: 'IMAGE_REQUIRED', message: 'No image file provided' });
      }

      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);

      // Resolve vendor ID from person ID
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor && !isAdmin) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      
      // Check vendor status - suspended vendors cannot upload images (unless admin)
      if (vendor && vendor.status === VendorStatus.SUSPENDED && !isAdmin) {
        return res.status(403).json({ error: 'VENDOR_SUSPENDED', message: 'Suspended vendor cannot perform this action' });
      }
      
      const vendorId = vendor?.id || personId;

      // Verify product exists and ownership
      const product = await productService.getProductById(productId);
      if (!product) {
        return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
      }

      if (!isAdmin && product.vendorId !== vendorId) {
        return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
      }

      // Get files to process (support both single and multiple)
      const filesToProcess = files && files.length > 0 ? files : [singleFile!];

      // Validate max 11 images (1 main + 10 gallery)
      if (filesToProcess.length > 11) {
        return res.status(400).json({ error: 'INVALID_IMAGE', message: 'Maximum 11 images allowed (1 main + 10 gallery)' });
      }

      // Process each file
      const uploadedImages: Array<{ key: string; url: string }> = [];
      const newImageUrls: string[] = [];

      try {
        for (const file of filesToProcess) {
          const ext = file.mimetype === 'image/jpeg' ? 'jpg' :
                      file.mimetype === 'image/png' ? 'png' : 'webp';
          const imageKey = `products/${product.vendorId}/${productId}/${randomUUID()}.${ext}`;
          const { url, key } = await storageAdapter.save(file.buffer, imageKey, file.mimetype);
          uploadedImages.push({ key, url });
          newImageUrls.push(url);
        }
      } catch (uploadError) {
        const failures = await Promise.allSettled(uploadedImages.map(image => storageAdapter.delete(image.key)));
        if (failures.some(result => result.status === 'rejected')) {
          throw new AggregateError([uploadError], 'Image upload and compensation failed');
        }
        throw uploadError;
      }

      // Add images to product (maintain order: main first, then gallery)
      const allImages = [...newImageUrls, ...product.images];
      // A failed persistence call can have committed; deleting here could destroy referenced images.
      await productService.updateProduct(productId, vendorId, { images: allImages }, isAdmin);

      // Return array for multiple, single object for backward compatibility with single upload
      if (files && files.length > 0) {
        return res.status(201).json({ images: uploadedImages });
      } else {
        return res.status(201).json({ image: uploadedImages[0] });
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Invalid file type') || error.message.includes('File size') || error.message.includes('File content') || error.message.includes('path traversal') || error.message.includes('Empty file') || error.message.includes('dimension')) {
          return res.status(400).json({ error: 'INVALID_IMAGE', message: error.message });
        }
        if (error.message === ProductError.PRODUCT_NOT_FOUND) {
          return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
        }
        if (error.message === ProductError.PRODUCT_OWNERSHIP_VIOLATION) {
          return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // DELETE /api/v1/products/:productId/images/:imageKey(*) - Delete product image (VENDOR role, ownership check)
  router.delete('/:productId/images/:imageKey(*)', authMw as RequestHandler, requireVendorOrAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const productId = getParam(req.params.productId);
      const imageKey = getParam(req.params.imageKey);

      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);

      // Resolve vendor ID
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor && !isAdmin) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this user' });
      }
      
      // Check vendor status - suspended vendors cannot delete images (unless admin)
      if (vendor && vendor.status === VendorStatus.SUSPENDED && !isAdmin) {
        return res.status(403).json({ error: 'VENDOR_SUSPENDED', message: 'Suspended vendor cannot perform this action' });
      }
      
      const vendorId = vendor?.id || personId;

      // Verify product exists and ownership
      const product = await productService.getProductById(productId);
      if (!product) {
        return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
      }

      if (!isAdmin && product.vendorId !== vendorId) {
        return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
      }

      // Check if image exists in product
      const imageUrl = storageAdapter.getUrl(imageKey);
      if (!product.images.includes(imageUrl)) {
        return res.status(404).json({ error: 'IMAGE_NOT_FOUND', message: 'Image not found for this product' });
      }

      // A snapshot cannot prove the object is unreferenced across concurrent writers.
      return res.status(503).json({ error: 'IMAGE_DELETE_UNAVAILABLE', message: 'Image deletion is temporarily unavailable' });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === ProductError.PRODUCT_NOT_FOUND) {
          return res.status(404).json({ error: ProductError.PRODUCT_NOT_FOUND, message: 'Product not found' });
        }
        if (error.message === ProductError.PRODUCT_OWNERSHIP_VIOLATION) {
          return res.status(403).json({ error: ProductError.PRODUCT_OWNERSHIP_VIOLATION, message: 'Access denied. You can only manage your own products.' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // Multer error handler - registered at router level to catch all multer errors (CR-006)
  router.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err && (err as any).name === 'MulterError') {
      const multerErr = err as any;
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'INVALID_IMAGE', message: 'File size exceeds maximum of 10MB' });
      }
      if (multerErr.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'INVALID_IMAGE', message: 'Too many files' });
      }
      if (multerErr.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'INVALID_IMAGE', message: 'Unexpected file field' });
      }
    }
    if (err && err.message && err.message.includes('Invalid file type')) {
      return res.status(400).json({ error: 'INVALID_IMAGE', message: err.message });
    }
    next(err);
  });

  return router;
}

export function createUploadRoutes({ storageAdapter, productRepo, reviewService }: {
  storageAdapter: StorageAdapter;
  productRepo?: Pick<ProductRepository, 'findById'>;
  reviewService?: Pick<ReviewService, 'findReviewById'>;
}): Router {
  const router = Router();

  // GET /api/v1/uploads/:key(*) - Serve uploaded image (public)
  router.get('/:key(*)', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = getParam(req.params.key);
      // Use adapter's sanitizeKey for consistent path traversal prevention (CR-002)
      let safeKey: string;
      try {
        safeKey = storageAdapter.sanitizeKey(key);
      } catch {
        return res.status(400).json({ error: 'INVALID_KEY', message: 'Invalid image key' });
      }

      // Never turn a malformed key into a different, potentially authorized key.
      const segments = safeKey.split('/');
      let visible = false;
      if (safeKey === key && /\.(?:jpg|jpeg|png|webp)$/.test(safeKey) && productRepo) {
        if (segments[0] === 'products' && segments.length >= 4 && segments.every(Boolean)) {
          const product = await productRepo.findById(segments[2]);
          visible = !!product && product.vendorId === segments[1]
            && (product.status === ProductStatus.ACTIVE || product.status === ProductStatus.OUT_OF_STOCK)
            && product.images.includes(storageAdapter.getUrl(safeKey));
        } else if (segments[0] === 'reviews' && segments.length === 4 && segments.every(Boolean) && reviewService) {
          const review = await reviewService.findReviewById(segments[2]);
          const product = await productRepo.findById(segments[1]);
          visible = !!review && review.productId === segments[1] && review.status === ReviewStatus.PUBLISHED
            && !!product && (product.status === ProductStatus.ACTIVE || product.status === ProductStatus.OUT_OF_STOCK)
            && review.images.includes(storageAdapter.getUrl(safeKey));
        }
      }
      if (!visible) {
        return res.status(404).json({ error: 'IMAGE_NOT_FOUND', message: 'Image not found' });
      }

       const filePath = path.join(config.storageRoot, safeKey);

       // Remote (S3) adapter: redirect to a presigned URL instead of streaming local file
       if (storageAdapter.isRemote && typeof storageAdapter.getSignedUrl === 'function') {
          const signed = await storageAdapter.getSignedUrl(safeKey, 60);
          res.setHeader('Cache-Control', 'no-store');
         return res.redirect(302, signed);
       }
      
      // Check if file exists and get stats
      let stats: fs.Stats;
      try {
        stats = await fs.promises.stat(filePath);
      } catch {
        return res.status(404).json({ error: 'IMAGE_NOT_FOUND', message: 'Image not found' });
      }

      // Determine content type from extension
      const ext = path.extname(key).toLowerCase();
      const contentTypeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
      };
      const contentType = contentTypeMap[ext] || 'application/octet-stream';

      // Generate ETag based on mtime + size (efficient, no content hash needed)
      const etag = `"${stats.mtimeMs.toFixed(0)}-${stats.size}"`;
      // Last-Modified in HTTP date format
      const lastModified = stats.mtime.toUTCString();

      // Conditional request headers
      const ifNoneMatch = req.headers['if-none-match'];
      const ifModifiedSince = req.headers['if-modified-since'];

      // Check If-None-Match (ETag)
      if (ifNoneMatch && ifNoneMatch === etag) {
        return res.status(304).set({
          'ETag': etag,
          'Last-Modified': lastModified,
          'Cache-Control': 'no-store',
        }).end();
      }

      // Check If-Modified-Since
      if (ifModifiedSince) {
        const sinceDate = new Date(ifModifiedSince);
        if (!isNaN(sinceDate.getTime()) && stats.mtime <= sinceDate) {
          return res.status(304).set({
            'ETag': etag,
            'Last-Modified': lastModified,
          'Cache-Control': 'no-store',
          }).end();
        }
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', lastModified);
      res.setHeader('Cache-Control', 'no-store');

      const fileStream = fs.createReadStream(filePath);
      
      // Handle stream errors (CR-007)
      fileStream.on('error', (streamErr) => {
        console.error('File stream error:', streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: 'STREAM_ERROR', message: 'Error reading file' });
        }
      });
      
      fileStream.pipe(res);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  return router;
}

export function createCategoryRoutes({ authService, productService, personRepo, vendorRepo }: ProductRoutesConfig): Router {
  const router = Router();

  const authMw = authMiddleware(authService);
  const requireAdmin = requireRole(PersonRole.ADMIN);

  // ============ Category Routes ============

  // POST /api/v1/categories - Create category (ADMIN role)
  router.post('/', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { name, slug, parentId } = req.body;

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: ProductError.CATEGORY_NAME_REQUIRED, message: 'Category name is required' });
      }
      if (!slug || slug.trim().length === 0) {
        return res.status(400).json({ error: ProductError.CATEGORY_SLUG_REQUIRED, message: 'Category slug is required' });
      }
      if (slug && !/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: ProductError.CATEGORY_SLUG_INVALID, message: 'Slug must contain only lowercase letters, numbers, and hyphens' });
      }

      const category = await productService.createCategory({
        name: name.trim(),
        slug: slug.trim(),
        parentId: parentId || null
      });

      return res.status(201).json({ category: categoryToResponse(category) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.CATEGORY_NAME_REQUIRED:
            return res.status(400).json({ error: ProductError.CATEGORY_NAME_REQUIRED, message: 'Category name is required' });
          case ProductError.CATEGORY_SLUG_REQUIRED:
            return res.status(400).json({ error: ProductError.CATEGORY_SLUG_REQUIRED, message: 'Category slug is required' });
          case ProductError.CATEGORY_SLUG_INVALID:
            return res.status(400).json({ error: ProductError.CATEGORY_SLUG_INVALID, message: 'Slug must contain only lowercase letters, numbers, and hyphens' });
          case ProductError.CATEGORY_SLUG_ALREADY_EXISTS:
            return res.status(409).json({ error: ProductError.CATEGORY_SLUG_ALREADY_EXISTS, message: 'Slug already exists' });
          case ProductError.CATEGORY_PARENT_NOT_FOUND:
            return res.status(404).json({ error: ProductError.CATEGORY_PARENT_NOT_FOUND, message: 'Parent category not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // GET /api/v1/categories - List categories (public)
  router.get('/', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const categories = await productService.listCategories();
      return res.json({ categories: categories.map(categoryToResponse) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // GET /api/v1/categories/:categoryId - Get category by ID (public)
  router.get('/:categoryId', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const categoryId = getParam(req.params.categoryId);
      const category = await productService.getCategoryById(categoryId);

      if (!category) {
        return res.status(404).json({ error: ProductError.CATEGORY_NOT_FOUND, message: 'Category not found' });
      }

      return res.json({ category: categoryToResponse(category) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // GET /api/v1/categories/slug/:slug - Get category by slug (public)
  router.get('/slug/:slug', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = getParam(req.params.slug);
      const category = await productService.getCategoryBySlug(slug);

      if (!category) {
        return res.status(404).json({ error: ProductError.CATEGORY_NOT_FOUND, message: 'Category not found' });
      }

      return res.json({ category: categoryToResponse(category) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // GET /api/v1/categories/:categoryId/children - Get child categories (public)
  router.get('/:categoryId/children', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const categoryId = getParam(req.params.categoryId);
      const children = await productService.getChildCategories(categoryId);

      return res.json({ categories: children.map(categoryToResponse) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/categories/:categoryId - Update category (ADMIN role)
  router.patch('/:categoryId', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const categoryId = getParam(req.params.categoryId);
      const { name, slug, parentId } = req.body;

      if (name !== undefined && (!name || name.trim().length === 0)) {
        return res.status(400).json({ error: ProductError.CATEGORY_NAME_REQUIRED, message: 'Category name cannot be empty' });
      }
      if (slug !== undefined) {
        if (!slug || slug.trim().length === 0) {
          return res.status(400).json({ error: ProductError.CATEGORY_SLUG_REQUIRED, message: 'Category slug cannot be empty' });
        }
        if (!/^[a-z0-9-]+$/.test(slug)) {
          return res.status(400).json({ error: ProductError.CATEGORY_SLUG_INVALID, message: 'Slug must contain only lowercase letters, numbers, and hyphens' });
        }
      }

      const updated = await productService.updateCategory(categoryId, {
        name: name?.trim(),
        slug: slug?.trim(),
        parentId: parentId !== undefined ? parentId : undefined
      });

      return res.json({ category: categoryToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.CATEGORY_NOT_FOUND:
            return res.status(404).json({ error: ProductError.CATEGORY_NOT_FOUND, message: 'Category not found' });
          case ProductError.CATEGORY_SLUG_ALREADY_EXISTS:
            return res.status(409).json({ error: ProductError.CATEGORY_SLUG_ALREADY_EXISTS, message: 'Slug already exists' });
          case ProductError.CATEGORY_CYCLE_DETECTED:
            return res.status(400).json({ error: ProductError.CATEGORY_CYCLE_DETECTED, message: 'Invalid parent category (cycle detected or self-reference)' });
          case ProductError.CATEGORY_PARENT_NOT_FOUND:
            return res.status(404).json({ error: ProductError.CATEGORY_PARENT_NOT_FOUND, message: 'Parent category not found' });
          case ProductError.CATEGORY_NAME_REQUIRED:
            return res.status(400).json({ error: ProductError.CATEGORY_NAME_REQUIRED, message: 'Category name is required' });
          case ProductError.CATEGORY_SLUG_REQUIRED:
            return res.status(400).json({ error: ProductError.CATEGORY_SLUG_REQUIRED, message: 'Category slug is required' });
          case ProductError.CATEGORY_SLUG_INVALID:
            return res.status(400).json({ error: ProductError.CATEGORY_SLUG_INVALID, message: 'Slug must contain only lowercase letters, numbers, and hyphens' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // DELETE /api/v1/categories/:categoryId - Delete category (ADMIN role)
  router.delete('/:categoryId', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const categoryId = getParam(req.params.categoryId);

      await productService.deleteCategory(categoryId);

      return res.status(204).send();
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case ProductError.CATEGORY_NOT_FOUND:
            return res.status(404).json({ error: ProductError.CATEGORY_NOT_FOUND, message: 'Category not found' });
          case ProductError.CATEGORY_HAS_CHILDREN:
            return res.status(400).json({ error: ProductError.CATEGORY_HAS_CHILDREN, message: 'Cannot delete category with children' });
          case ProductError.CATEGORY_HAS_PRODUCTS:
            return res.status(400).json({ error: ProductError.CATEGORY_HAS_PRODUCTS, message: 'Cannot delete category with products' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}

function productToResponse(product: any) {
  return {
    id: product.id,
    vendorId: product.vendorId,
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    price: product.price,
    quantity: product.quantity,
    status: product.status,
    images: product.images || [],
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
}

function categoryToResponse(category: any) {
  return {
    id: category.id,
    parentId: category.parentId,
    name: category.name,
    slug: category.slug,
    path: category.path,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt
  };
}
