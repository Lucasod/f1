import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AwsS3Client } from './aws-s3.client';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';

const presignMock = vi.hoisted(() => vi.fn(async () => 'https://signed.example.com/key'));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: presignMock,
}));

describe('AwsS3Client.getSignedUrl', () => {
  beforeEach(() => {
    presignMock.mockClear();
  });

  it('uses the configured bucket when params is a string', async () => {
    const client = new AwsS3Client('us-east-1', 'test-bucket');
    await client.getSignedUrl('products/v1/p1/main.jpg');
    expect(presignMock).toHaveBeenCalledTimes(1);
    const [, command] = presignMock.mock.calls[0];
    expect(command.input.Bucket).toBe('test-bucket');
    expect(command.input.Key).toBe('products/v1/p1/main.jpg');
  });

  it('uses params.Bucket when params is an object', async () => {
    const client = new AwsS3Client('us-east-1', 'default-bucket');
    await client.getSignedUrl({ Bucket: 'object-bucket', Key: 'obj-key.jpg' });
    expect(presignMock).toHaveBeenCalledTimes(1);
    const [, command] = presignMock.mock.calls[0];
    expect(command.input.Bucket).toBe('object-bucket');
    expect(command.input.Key).toBe('obj-key.jpg');
  });
});
