import { StorageAdapter } from './storage.interface';
import { LocalStorageAdapter } from './local.adapter';
import { S3StorageAdapter } from './s3.adapter';
import { AwsS3Client } from './aws-s3.client';

export function createStorageAdapter(): StorageAdapter {
  const bucket = (process.env.AWS_S3_BUCKET || '').trim();
  const region = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim();
  if (!!bucket !== !!region) {
    throw new Error('Incomplete S3 configuration: bucket and region are both required');
  }
  if (bucket && region) {
    const client = new AwsS3Client(region);
    return new S3StorageAdapter({
      bucket,
      region,
      publicUrlBase: (process.env.AWS_S3_PUBLIC_URL_BASE || '/api/v1/uploads').trim(),
      storageClass: (process.env.AWS_S3_STORAGE_CLASS || 'STANDARD').trim(),
    }, client);
  }
  return new LocalStorageAdapter();
}
