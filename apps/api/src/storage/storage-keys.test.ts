import { describe, expect, it } from 'vitest';
import { newKey, parseKey, sniffImage } from './storage-keys';

const ORG = '6f1c2f8e-9a51-4d0e-8a7e-1b1f2b3c4d5e';

describe('storage keys', () => {
  it('names the organization and kind and round-trips', () => {
    const key = newKey(ORG, 'product', 'png');
    expect(parseKey(key)).toEqual({ organizationId: ORG, kind: 'product', ext: 'png' });
  });

  it('refuses anything that could be a path', () => {
    for (const bad of [
      '../etc/passwd',
      `${ORG}/product/x.png`,
      `${ORG}.product.${ORG}.png/../x`,
      `${ORG}.product.${ORG}.exe`,
    ]) {
      expect(parseKey(bad)).toBeNull();
    }
  });
});

describe('sniffImage', () => {
  it('recognizes JPEG, PNG and WebP by their bytes', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'png',
    );
    expect(sniffImage(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'binary'))).toBe('webp');
  });

  it('rejects other files whatever they claim to be', () => {
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImage(Buffer.from('<svg></svg>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});
