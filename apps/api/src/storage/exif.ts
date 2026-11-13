/**
 * Reads DateTimeOriginal ("YYYY:MM:DD HH:MM:SS", camera local time) from a JPEG's EXIF block.
 * Returns null when the file has none. Only the few bytes needed are parsed; no dependency.
 */
export function exifTakenAt(buf: Buffer): string | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const size = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.toString('ascii', i + 4, i + 10) === 'Exif\0\0') {
      return readTiff(buf.subarray(i + 10, i + 2 + size));
    }
    if (marker === 0xda) return null; // image data starts; no EXIF before it
    i += 2 + size;
  }
  return null;
}

function readTiff(t: Buffer): string | null {
  if (t.length < 8) return null;
  const le = t.toString('ascii', 0, 2) === 'II';
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const find = (
    ifd: number,
    tag: number,
  ): { type: number; count: number; value: number } | null => {
    if (ifd + 2 > t.length) return null;
    const n = u16(ifd);
    for (let k = 0; k < n; k += 1) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > t.length) return null;
      if (u16(e) === tag) return { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8) };
    }
    return null;
  };
  const exifPtr = find(u32(4), 0x8769);
  if (!exifPtr) return null;
  const date = find(exifPtr.value, 0x9003);
  if (!date || date.type !== 2 || date.count < 19 || date.value + 19 > t.length) return null;
  const text = t.toString('ascii', date.value, date.value + 19);
  return /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text : null;
}

/** A minimal JPEG with an EXIF DateTimeOriginal, for tests. */
export function jpegWithExifDate(taken: string): Buffer {
  const tiff = Buffer.alloc(8 + 18 + 18 + 20);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 at 8
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18); // Exif IFD at 26
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(20, 32);
  tiff.writeUInt32LE(44, 36); // string at 44
  tiff.writeUInt32LE(0, 40);
  tiff.write(`${taken}\0`, 44, 'ascii');
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(app1.length + 2, 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    header,
    app1,
    Buffer.from([0xff, 0xda, 0, 2]),
    Buffer.alloc(16, 7),
  ]);
}
