import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { productApi, Product, Category, CreateProductInput, UpdateProductInput } from '@/shared/api/product';
import { useAuth } from '@/app/providers/AuthProvider';

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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);

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
      if (product.images.length > 0) {
        setImagePreview(product.images[0]);
      }
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

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setValidationErrors(prev => ({ ...prev, image: 'Invalid file type. Use JPEG, PNG, or WebP.' }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setValidationErrors(prev => ({ ...prev, image: 'File too large. Maximum 10MB.' }));
      return;
    }
    setValidationErrors(prev => ({ ...prev, image: '' }));
    if (isEdit && productId) {
      setUploadingImage(true);
      try {
        const result = await productApi.uploadImage(productId, file);
        setFormData(prev => ({ ...prev, images: [...(prev.images || []), result.image.url] }));
        setImagePreview(result.image.url);
      } catch (err) {
        setValidationErrors(prev => ({ ...prev, image: err instanceof Error ? err.message : 'Upload error' }));
      } finally {
        setUploadingImage(false);
      }
    } else {
      setPendingImageFile(file);
      const objectUrl = URL.createObjectURL(file);
      setFormData(prev => ({ ...prev, images: [...(prev.images || []), objectUrl] }));
      setImagePreview(objectUrl);
    }
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
      setFormData(prev => ({ ...prev, images: (prev.images || []).filter(img => img !== imageUrl) }));
      if (imagePreview === imageUrl) {
        setImagePreview(formData.images?.[1] || null);
      }
      return;
    }
    try {
      const key = extractImageKey(imageUrl);
      await productApi.deleteImage(productId, key);
      setFormData(prev => ({ ...prev, images: (prev.images || []).filter(img => img !== imageUrl) }));
      if (imagePreview === imageUrl) {
        setImagePreview(formData.images?.[1] || null);
      }
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
      if (!isEdit && createdProductId && pendingImageFile) {
        setUploadingImage(true);
        try {
          await productApi.uploadImage(createdProductId, pendingImageFile);
        } catch (err) {
          console.error('Failed to upload image after product creation:', err);
        } finally {
          setUploadingImage(false);
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
    (formData.images || []).forEach(img => {
      if (img.startsWith('blob:')) {
        URL.revokeObjectURL(img);
      }
    });
    navigate('/vendor/dashboard');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          {isEdit ? 'Edit Product' : 'New Product'}
        </h1>
        <button
          onClick={handleCancel}
          className="px-4 py-2 text-gray-600 hover:text-gray-900"
          disabled={isSubmitting}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Product Name *
          </label>
          <input
            id="name"
            type="text"
            value={formData.name}
            onChange={e => handleChange('name', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg ${validationErrors.name ? 'border-red-500' : 'border-gray-300'} focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
            placeholder="Product name"
            disabled={isSubmitting}
          />
          {validationErrors.name && <p className="mt-1 text-sm text-red-600">{validationErrors.name}</p>}
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description *
          </label>
          <textarea
            id="description"
            value={formData.description}
            onChange={e => handleChange('description', e.target.value)}
            rows={4}
            className={`w-full px-3 py-2 border rounded-lg ${validationErrors.description ? 'border-red-500' : 'border-gray-300'} focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
            placeholder="Product description"
            disabled={isSubmitting}
          />
          {validationErrors.description && <p className="mt-1 text-sm text-red-600">{validationErrors.description}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
              Price *
            </label>
            <input
              id="price"
              type="number"
              step="0.01"
              value={formData.price}
              onChange={e => handleChange('price', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg ${validationErrors.price ? 'border-red-500' : 'border-gray-300'} focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
              placeholder="0,00"
              disabled={isSubmitting}
            />
            {validationErrors.price && <p className="mt-1 text-sm text-red-600">{validationErrors.price}</p>}
          </div>

          <div>
            <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-1">
              Stock Quantity *
            </label>
            <input
              id="quantity"
              type="number"
              step="1"
              value={formData.quantity}
              onChange={e => handleChange('quantity', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg ${validationErrors.quantity ? 'border-red-500' : 'border-gray-300'} focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
              placeholder="0"
              disabled={isSubmitting}
            />
            {validationErrors.quantity && <p className="mt-1 text-sm text-red-600">{validationErrors.quantity}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="categoryId" className="block text-sm font-medium text-gray-700 mb-1">
            Category *
          </label>
          <select
            id="categoryId"
            value={formData.categoryId}
            onChange={e => handleChange('categoryId', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg ${validationErrors.categoryId ? 'border-red-500' : 'border-gray-300'} focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
            disabled={isSubmitting}
          >
            <option value="">Select a category</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          {validationErrors.categoryId && <p className="mt-1 text-sm text-red-600">{validationErrors.categoryId}</p>}
        </div>

        <div>
          <label htmlFor="image" className="block text-sm font-medium text-gray-700 mb-1">
            Product Image
          </label>
          {imagePreview && (
            <div className="mb-4 flex items-center gap-4">
              <img src={imagePreview} alt={formData.name || 'Product'} className="h-24 w-24 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => handleRemoveImage(imagePreview)}
                className="text-red-600 hover:text-red-900 text-sm"
                disabled={uploadingImage}
              >
                Remove image
              </button>
            </div>
          )}
          <input
            type="file"
            id="image"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageUpload}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            disabled={isSubmitting || uploadingImage}
          />
          {uploadingImage && <p className="mt-1 text-sm text-blue-600">Uploading image...</p>}
          {validationErrors.image && <p className="mt-1 text-sm text-red-600">{validationErrors.image}</p>}
          <p className="mt-1 text-xs text-gray-500">JPEG, PNG, or WebP. Maximum 10MB.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            value={formData.status}
            onChange={e => handleChange('status', e.target.value as Product['status'])}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={isSubmitting}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="out_of_stock">Out of Stock</option>
            <option value="discontinued">Discontinued</option>
          </select>
        </div>

        <div className="flex justify-end gap-4 pt-6 border-t border-gray-200">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-gray-600 hover:text-gray-900"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
