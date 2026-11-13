import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { parseKey } from './storage-keys';

interface Driver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

/** Development and tests: files on local disk, served by FilesController behind a signature. */
class LocalDriver implements Driver {
  constructor(private readonly dir: string) {}

  async put(key: string, body: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), body);
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.file(key))).isFile();
    } catch {
      return false;
    }
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.file(key));
    } catch {
      return null;
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = signFile(key, expires);
    return `${env().PUBLIC_API_URL}/api/v1/files/${key}?expires=${expires}&signature=${signature}`;
  }

  private file(key: string): string {
    if (!parseKey(key)) throw new Error('Invalid storage key');
    return path.join(this.dir, key);
  }
}

/** Production: a private S3-compatible bucket; links are presigned and short-lived. */
class S3Driver implements Driver {
  private readonly client: S3Client;

  constructor(private readonly bucket: string) {
    const e = env();
    this.client = new S3Client({
      region: e.STORAGE_REGION,
      ...(e.STORAGE_ENDPOINT ? { endpoint: e.STORAGE_ENDPOINT, forcePathStyle: true } : {}),
      ...(e.STORAGE_KEY && e.STORAGE_SECRET
        ? { credentials: { accessKeyId: e.STORAGE_KEY, secretAccessKey: e.STORAGE_SECRET } }
        : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  signedUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
}

/** HMAC over key and expiry, with a key derived from the access-token secret. */
export function signFile(key: string, expires: number): string {
  return createHmac('sha256', `files:${env().JWT_ACCESS_SECRET}`)
    .update(`${key}:${expires}`)
    .digest('base64url');
}

export function verifyFileSignature(key: string, expires: number, signature: string): boolean {
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signFile(key, expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Private file storage for product pictures and, later, task photos (spec section 12). */
@Injectable()
export class StorageService {
  private readonly driver: Driver;

  constructor() {
    const e = env();
    if (e.STORAGE_DRIVER === 's3') {
      if (!e.STORAGE_BUCKET) throw new Error('STORAGE_BUCKET is required when STORAGE_DRIVER=s3');
      this.driver = new S3Driver(e.STORAGE_BUCKET);
    } else {
      this.driver = new LocalDriver(e.STORAGE_LOCAL_DIR);
    }
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.driver.put(key, body, contentType);
  }

  exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  signedUrl(key: string): Promise<string> {
    return this.driver.signedUrl(key, env().SIGNED_URL_TTL_SECONDS);
  }

  /** Only the local driver serves files through the API. */
  readLocal(key: string): Promise<Buffer | null> {
    return this.driver instanceof LocalDriver ? this.driver.read(key) : Promise.resolve(null);
  }
}
