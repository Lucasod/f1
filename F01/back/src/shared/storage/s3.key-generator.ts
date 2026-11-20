export function sanitizeFilename(filename: string): string {
  const base = String(filename ?? '').split(/[\\/]/).pop() || '';
  // Remove path traversal sequences and disallowed characters
  const withoutTraversal = base.replace(/\.\./g, '');
  return withoutTraversal.replace(/[^a-zA-Z0-9.\-_]/g, '');
}

export function generateProductImageKey(vendorId: string, productId: string, filename: string): string {
  const safeName = sanitizeFilename(filename);
  return `products/${vendorId}/${productId}/${safeName}`;
}

export function generateReviewImageKey(productId: string, reviewId: string, filename: string): string {
  const safeName = sanitizeFilename(filename);
  return `reviews/${productId}/${reviewId}/${safeName}`;
}

export function generateInvoiceKey(orderId: string, year: number | string, month: number | string): string {
  const m = String(month).padStart(2, '0');
  return `invoices/${year}/${m}/${orderId}.pdf`;
}

export function generateTempKey(filename: string): string {
  const safeName = sanitizeFilename(filename);
  return `temp/${safeName}`;
}
