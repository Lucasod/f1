import { PRODUCTS, VENDORS } from './seed';

type Publisher = {
  read: (filename: string) => Promise<Buffer>;
  put: (key: string, image: Buffer) => Promise<void>;
};

export async function publishSeedBrandImages(publisher: Publisher): Promise<void> {
  for (const product of PRODUCTS.filter(item => item.imageFilename)) {
    const vendor = VENDORS.find(item => item.slug === product.vendorSlug);
    if (!vendor || !product.imageFilename) throw new Error('SEED_IMAGE_VENDOR_MISSING');
    const filename = product.imageFilename.replace(/^main-/, '');
    const image = await publisher.read(filename);
    await publisher.put(`products/${vendor.id}/${product.id}/${product.imageFilename}`, image);
  }
}
