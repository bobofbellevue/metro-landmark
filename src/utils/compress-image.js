/**
 * Shrink phone photos before the 10MB document upload cap.
 * PDFs and non-images are left alone. HEIC often cannot be decoded in
 * the browser; callers keep the original and the existing size check.
 */

export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_COMPRESS_MAX_EDGE = 1920;
export const IMAGE_COMPRESS_QUALITY = 0.72;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;

/**
 * @param {{ type?: string, name?: string }|null|undefined} file
 * @returns {boolean}
 */
export function isCompressibleImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return false;
  if (type.startsWith('image/')) return true;
  return IMAGE_EXT.test(name);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} [maxEdge]
 * @returns {{ width: number, height: number }}
 */
export function scaledImageDimensions(width, height, maxEdge = IMAGE_COMPRESS_MAX_EDGE) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const cap = Number(maxEdge) || IMAGE_COMPRESS_MAX_EDGE;
  if (w <= 0 || h <= 0) return { width: 1, height: 1 };
  const longest = Math.max(w, h);
  if (longest <= cap) return { width: w, height: h };
  const scale = cap / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * @param {string} originalName
 * @returns {string}
 */
export function jpegFileName(originalName) {
  const base = String(originalName || 'image').replace(/\.[^.]+$/, '');
  return `${base || 'image'}.jpg`;
}

function makeCanvas(width, height) {
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  return null;
}

function canvasToJpegBlob(canvas, quality) {
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error('Could not encode image'));
          else resolve(blob);
        },
        'image/jpeg',
        quality
      );
    });
  }
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return Promise.reject(new Error('Could not encode image'));
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // HEIC / odd codecs often fail here; try an HTMLImageElement next.
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    throw new Error('decode-failed');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode-failed'));
      img.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encodeJpeg(source, width, height, quality) {
  const canvas = makeCanvas(width, height);
  if (!canvas) throw new Error('no-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvasToJpegBlob(canvas, quality);
}

/**
 * @param {File} file
 * @param {{ maxBytes?: number, maxEdge?: number, quality?: number }} [options]
 * @returns {Promise<{ file: File, compressed: boolean, reason?: string, originalBytes?: number, bytes?: number }>}
 */
export async function compressImageFile(file, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES;
  if (!file || !isCompressibleImageFile(file)) {
    return { file, compressed: false, reason: 'not-image' };
  }

  let source;
  try {
    source = await loadImageSource(file);
  } catch {
    return { file, compressed: false, reason: 'decode-failed' };
  }

  try {
    let { width, height } = scaledImageDimensions(
      source.width,
      source.height,
      options.maxEdge ?? IMAGE_COMPRESS_MAX_EDGE
    );
    let quality = options.quality ?? IMAGE_COMPRESS_QUALITY;
    let blob = await encodeJpeg(source, width, height, quality);

    while (blob.size > maxBytes && quality > 0.42) {
      quality = Math.max(0.4, quality - 0.12);
      blob = await encodeJpeg(source, width, height, quality);
    }
    while (blob.size > maxBytes && Math.max(width, height) > 640) {
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
      blob = await encodeJpeg(source, width, height, quality);
    }

    if (blob.size >= file.size) {
      return { file, compressed: false, reason: 'no-gain', originalBytes: file.size };
    }

    const next = new File([blob], jpegFileName(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
    return {
      file: next,
      compressed: true,
      originalBytes: file.size,
      bytes: next.size,
    };
  } catch {
    return { file, compressed: false, reason: 'encode-failed' };
  } finally {
    if (source && typeof source.close === 'function') {
      source.close();
    }
  }
}
