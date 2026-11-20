import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { S3ClientInterface, PutObjectParams, DeleteObjectParams, GetSignedUrlParams } from './s3.adapter';

export class AwsS3Client implements S3ClientInterface {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(region: string, bucket: string) { this.client = new S3Client({ region }); this.bucket = bucket; }
  async putObject(params: PutObjectParams): Promise<any> {
    return this.client.send(new PutObjectCommand({
      Bucket: params.Bucket,
      Key: params.Key,
      Body: params.Body,
      ContentType: params.ContentType,
      StorageClass: params.StorageClass as any,
    }));
  }
  async deleteObject(params: DeleteObjectParams): Promise<any> {
    return this.client.send(new DeleteObjectCommand({ Bucket: params.Bucket, Key: params.Key }));
  }
  getSignedUrl(params: GetSignedUrlParams | string, expiresIn?: number): Promise<string> {
    const bucket = typeof params === 'string' ? this.bucket : params.Bucket;
    const key = typeof params === 'string' ? params : params.Key;
    const expires = expiresIn ?? (typeof params === 'string' ? 3600 : (params.Expires ?? 3600));
    return presign(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expires });
  }
  async listObjectsV2(params: { Bucket: string; Prefix?: string; ContinuationToken?: string; MaxKeys?: number }): Promise<any> {
    return this.client.send(new ListObjectsV2Command(params));
  }
  async deleteObjects(params: { Bucket: string; Delete: { Objects: { Key: string }[] } }): Promise<any> {
    return this.client.send(new DeleteObjectsCommand(params));
  }
}
