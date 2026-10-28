import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { productApi, Product, Category, CreateProductInput, UpdateProductInput } from '@/shared/api/product';
import { useAuth } from '@/app/providers/AuthProvider';
import { Input, Textarea, Select, Button, Card, ErrorAlert, Spinner, Badge } from '@/components/ui';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'out_of_stock', label: 'Out of Stock' },
  { value: 'discontinued', label: 'Discontinued' },
];

export function ProductForm() {
  const { productId } = useParams<{ productId?: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isEdit = !!productId;

  const [formData, setFormData] = useState<CreateProductInput>({
    categoryId: '',
    name: '',
    description: '',
    price: 0,
    quantity: 0,
    images: [],
    status: 'active',
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [pendingImageFiles, setPendingImageFiles] = useState<File[]>([]);

  useEffect(() => {
    loadCategories();
    if (isEdit) {
      loadProduct();
    }
  }, [productId]);

  const loadCategories = async () => {
    try {
      const response = await fetch('/api/v1/categories', {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      }
    } catch {
      // Ignore category load errors
    }
  };

  const loadProduct = async () => {
    if (!productId) return;
    setIsLoading(true);
    try {
      const response = await productApi.getById(productId);
      const product = response.product;
      setFormData({
        categoryId: product.categoryId,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        quantity: Number(product.quantity),
        images: product.images || [],
        status: product.status,
      });
      setImagePreviews(product.images || []);
    } catch (err) {
      setError('Error loading product');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (validationErrors[field]) {
      setValidationErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = 'Name is required';
    if (!formData.description.trim()) newErrors.description = 'Description is required';
    const priceNum = parseFloat(String(formData.price));
    if (formData.price === 0 || isNaN(priceNum) || priceNum <= 0) newErrors.price = 'Price must be positive';
    const qtyNum = parseInt(String(formData.quantity));
    if (formData.quantity === 0 || isNaN(qtyNum) || !Number.isInteger(qtyNum) || qtyNum < 0) newErrors.quantity = 'Quantity must be a non-negative integer';
    if (!formData.categoryId) newErrors.categoryId = 'Category is required';
    setValidationErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateImageFiles = (files: FileList | File[]): string | null => {
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        return 'Invalid file type. Use JPEG, PNG, or WebP.';
      }
      if (file.size > 10 * 1024 * 1024) {
        return 'File too large. Maximum 10MB per image.';
      }
    }
    if (fileArray.length > 11) {
      return 'Maximum 11 images allowed (1 main + 10 gallery).';
    }
    return null;
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const validationError = validateImageFiles(files);
    if (validationError) {
      setValidationErrors(prev => ({ ...prev, image: validationError }));
      return;
    }
    setValidationErrors(prev => ({ ...prev, image: '' }));

    const fileArray = Array.from(files);
    const objectUrls = fileArray.map(file => URL.createObjectURL(file));
    
    if (isEdit && productId) {
      setUploadingImages(true);
      try {
        const result = await productApi.uploadImages(productId, fileArray);
        setFormData(prev => ({ 
          ...prev, 
          images: [...(prev.images || []).filter(img => !img.startsWith('blob:')), ...result.images.map(img => img.url)] 
        }));
        setImagePreviews(prev => [...prev.filter(img => !img.startsWith('blob:')), ...result.images.map(img => img.url)]);
      } catch (err) {
        setValidationErrors(prev => ({ ...prev, image: err instanceof Error ? err.message : 'Upload error' }));
      } finally {
        setUploadingImages(false);
      }
    } else {
      setPendingImageFiles(prev => [...prev, ...fileArray]);
      setFormData(prev => ({ ...prev, images: [...(prev.images || []), ...objectUrls] }));
      setImagePreviews(prev => [...prev, ...objectUrls]);
    }
    // Reset input to allow re-uploading same file
    event.target.value = '';
  };

  const extractImageKey = (imageUrl: string): string => {
    const uploadsPrefix = '/api/v1/uploads/';
    const index = imageUrl.indexOf(uploadsPrefix);
    if (index !== -1) {
      return imageUrl.substring(index + uploadsPrefix.length);
    }
    return imageUrl;
  };

  const handleRemoveImage = async (imageUrl: string) => {
    if (!isEdit || !productId) {
      // Remove from local state
      setFormData(prev => ({ ...prev, images: (prev.images || []).filter(img => img !== imageUrl) }));
      setImagePreviews(prev => prev.filter(img => img !== imageUrl));
      // Revoke object URL if it's a blob
      if (imageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imageUrl);
        setPendingImageFiles(prev => {
          const idx = prev.findIndex(f => URL.createObjectURL(f) === imageUrl);
          if (idx >= 0) {
            const newFiles = [...prev];
            newFiles.splice(idx, 1);
            return newFiles;
          }
          return prev;
        });
      }
      return;
    }
    try {
      const key = extractImageKey(imageUrl);
      await productApi.deleteImage(productId, key);
      setFormData(prev => ({ ...prev, images: (prev.images || []).filter(img => img !== imageUrl) }));
      setImagePreviews(prev => prev.filter(img => img !== imageUrl));
    } catch (err) {
      setError('Error removing image');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    if (!hasRole('VENDOR') && !hasRole('ADMIN')) {
      setError('Unauthorized access');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const submitData = {
        ...formData,
        price: parseFloat(String(formData.price)),
        quantity: parseInt(String(formData.quantity)),
        images: (formData.images || []).filter(img => !img.startsWith('blob:')),
      };
      let createdProductId: string | undefined;
      if (isEdit && productId) {
        await productApi.update(productId, submitData as UpdateProductInput);
      } else {
        const response = await productApi.create(submitData as CreateProductInput);
        createdProductId = response.product?.id;
      }
      if (!isEdit && createdProductId && pendingImageFiles.length > 0) {
        setUploadingImages(true);
        try {
          await productApi.uploadImages(createdProductId, pendingImageFiles);
        } catch (err) {
          console.error('Failed to upload images after product creation:', err);
        } finally {
          setUploadingImages(false);
        }
      }
      navigate('/vendor/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving product');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    // Revoke all blob URLs from formData.images (includes pending images' blob URLs)
    (formData.images || []).forEach(img => {
      if (img.startsWith('blob:')) {
        URL.revokeObjectURL(img);
      }
    });
    navigate('/vendor/dashboard');
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="status" aria-live="polite">
        <div className="flex items-center justify-center min-h-[300px]">
          <Spinner size="lg" label="Loading..." />
        </div>
      </div>
    );
  }

  const categoryOptions = [
    { value: '', label: 'Select a category' },
    ...categories.map(cat => ({ value: cat.id, label: cat.name })),
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          {isEdit ? 'Edit Product' : 'New Product'}
        </h1>
        <Button variant="ghost" onClick={handleCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>

      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => setError(null)}
          dismissible
          className="mb-6"
        />
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <Card variant="bordered" padding="lg">
          <div className="space-y-6">
            <Input
              id="name"
              type="text"
              label="Product Name"
              required
              value={formData.name}
              onChange={e => handleChange('name', e.target.value)}
              error={validationErrors.name}
              placeholder="Product name"
              disabled={isSubmitting}
              aria-invalid={!!validationErrors.name}
            />

            <Textarea
              id="description"
              label="Description"
              required
              value={formData.description}
              onChange={e => handleChange('description', e.target.value)}
              error={validationErrors.description}
              placeholder="Product description"
              rows={4}
              disabled={isSubmitting}
              aria-invalid={!!validationErrors.description}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Input
                id="price"
                type="number"
                label="Price"
                required
                step="0.01"
                value={formData.price}
                onChange={e => handleChange('price', e.target.value)}
                error={validationErrors.price}
                placeholder="0.00"
                disabled={isSubmitting}
                aria-invalid={!!validationErrors.price}
              />

              <Input
                id="quantity"
                type="number"
                label="Stock Quantity"
                required
                step="1"
                value={formData.quantity}
                onChange={e => handleChange('quantity', e.target.value)}
                error={validationErrors.quantity}
                placeholder="0"
                disabled={isSubmitting}
                aria-invalid={!!validationErrors.quantity}
              />
            </div>

            <Select
              id="categoryId"
              label="Category"
              required
              value={formData.categoryId}
              onChange={e => handleChange('categoryId', e.target.value)}
              error={validationErrors.categoryId}
              options={categoryOptions}
              disabled={isSubmitting}
              aria-invalid={!!validationErrors.categoryId}
            />

            <div>
              <label htmlFor="image" className="block text-sm font-medium text-gray-700 mb-1">
                Product Images (Max 11: 1 Main + 10 Gallery)
              </label>
              {imagePreviews.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-4">
                  {imagePreviews.map((preview, index) => (
                    <div key={preview} className="relative group">
                      <img 
                        src={preview} 
                        alt={`${formData.name || 'Product'} image ${index + 1}`} 
                        className="h-24 w-24 rounded-lg object-cover border border-gray-200"
                      />
                      {index === 0 && (
                        <Badge variant="info" className="absolute -top-2 -right-2">
                          Main
                        </Badge>
                      )}
                      {index > 0 && (
                        <Badge variant="neutral" className="absolute -top-2 -right-2">
                          Gallery {index}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveImage(preview)}
                        disabled={uploadingImages}
                        className="absolute bottom-1 right-1 bg-red-600 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label={`Remove image ${index + 1}`}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <input
                type="file"
                id="image"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleImageUpload}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                disabled={isSubmitting || uploadingImages}
              />
              {uploadingImages && <p className="mt-1 text-sm text-blue-600">Uploading images...</p>}
              {validationErrors.image && <p className="mt-1 text-sm text-red-600" role="alert">{validationErrors.image}</p>}
              <p className="mt-1 text-xs text-gray-500">JPEG, PNG, or WebP. Maximum 10MB per image. First image becomes main, rest become gallery.</p>
            </div>

            <Select
              id="status"
              label="Status"
              value={formData.status}
              onChange={e => handleChange('status', e.target.value as Product['status'])}
              options={STATUS_OPTIONS}
              disabled={isSubmitting}
            />
          </div>
        </Card>

        <div className="flex justify-end gap-4 pt-6 border-t border-gray-200">
          <Button variant="secondary" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}