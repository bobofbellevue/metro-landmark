import {
  compressImageFile,
  isCompressibleImageFile,
  jpegFileName,
  scaledImageDimensions,
} from '../../src/utils/compress-image.js';

describe('compress-image helpers', () => {
  test('skips PDFs and non-images', () => {
    expect(
      isCompressibleImageFile({ type: 'application/pdf', name: 'receipt.pdf' })
    ).toBe(false);
    expect(
      isCompressibleImageFile({ type: 'image/jpeg', name: 'check.jpg' })
    ).toBe(true);
    expect(isCompressibleImageFile({ type: '', name: 'IMG_1234.HEIC' })).toBe(true);
    expect(isCompressibleImageFile({ type: 'text/plain', name: 'notes.txt' })).toBe(
      false
    );
  });

  test('scales the long edge down', () => {
    expect(scaledImageDimensions(4000, 3000, 1920)).toEqual({
      width: 1920,
      height: 1440,
    });
    expect(scaledImageDimensions(800, 600, 1920)).toEqual({
      width: 800,
      height: 600,
    });
  });

  test('jpegFileName replaces the extension', () => {
    expect(jpegFileName('IMG_1234.HEIC')).toBe('IMG_1234.jpg');
    expect(jpegFileName('scan.png')).toBe('scan.jpg');
  });

  test('compressImageFile is a no-op for PDFs', async () => {
    const original = { name: 'receipt.pdf', type: 'application/pdf', size: 12 };
    const result = await compressImageFile(original);
    expect(result.compressed).toBe(false);
    expect(result.reason).toBe('not-image');
    expect(result.file).toBe(original);
  });
});
