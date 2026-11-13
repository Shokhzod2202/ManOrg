import { randomUUID } from 'node:crypto';

/**
 * Storage keys are one flat segment, `<organization id>.<kind>.<uuid>.<ext>`, so they can never
 * contain a path, and the organization a file belongs to is part of its name.
 */
export type FileKind = 'product' | 'task';
export type ImageExt = 'jpg' | 'png' | 'webp';

const KEY = /^([0-9a-f-]{36})\.(product|task)\.([0-9a-f-]{36})\.(jpg|png|webp)$/;

export function newKey(organizationId: string, kind: FileKind, ext: ImageExt): string {
  return `${organizationId}.${kind}.${randomUUID()}.${ext}`;
}

export function parseKey(
  key: string,
): { organizationId: string; kind: FileKind; ext: ImageExt } | null {
  const m = KEY.exec(key);
  if (!m) return null;
  return { organizationId: m[1]!, kind: m[2] as FileKind, ext: m[4] as ImageExt };
}

export const CONTENT_TYPES: Record<ImageExt, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Detects the image type from the file's first bytes; the client's declared type is ignored. */
export function sniffImage(buffer: Buffer): ImageExt | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'jpg';
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}
