import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { publishSeedBrandImages } from '../src/scripts/seed-image-publication';

dotenv.config();

async function main(): Promise<void> {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  const region = process.env.AWS_REGION?.trim();
  if (process.env.NODE_ENV === 'production' || !bucket || !region) {
    throw new Error('A non-production environment, AWS_S3_BUCKET and AWS_REGION are required');
  }
  const client = new S3Client({ region });
  await publishSeedBrandImages({
    read: filename => readFile(resolve(process.cwd(), 'fixtures/demo-images', filename)),
    put: async (key, image) => {
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: image, ContentType: 'image/png', IfNoneMatch: '*' }));
        console.log(`Published ${key}`);
      } catch (error) {
        if (!(error instanceof Error) || !['PreconditionFailed', 'ConditionalRequestConflict'].includes(error.name)) throw error;
        const existing = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await existing.Body?.transformToByteArray();
        if (!bytes || !Buffer.from(bytes).equals(image)) throw new Error(`Existing object differs: ${key}`);
        console.log(`Already present ${key}`);
      }
    },
  });
}

main().catch(() => {
  console.error('Seed image publication failed; check configuration and object conflicts.');
  process.exitCode = 1;
});
