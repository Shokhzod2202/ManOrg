import { describe, expect, it } from 'vitest';
import { exifTakenAt, jpegWithExifDate } from './exif';

describe('exifTakenAt', () => {
  it('reads DateTimeOriginal from a JPEG', () => {
    expect(exifTakenAt(jpegWithExifDate('2026:11:13 09:15:00'))).toBe('2026:11:13 09:15:00');
  });

  it('returns null without EXIF or for other files', () => {
    expect(exifTakenAt(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 1, 2]))).toBeNull();
    expect(exifTakenAt(Buffer.from('%PDF'))).toBeNull();
    expect(exifTakenAt(Buffer.alloc(0))).toBeNull();
  });

  it('survives truncated data', () => {
    const full = jpegWithExifDate('2026:11:13 09:15:00');
    expect(exifTakenAt(full.subarray(0, 30))).toBeNull();
  });
});
