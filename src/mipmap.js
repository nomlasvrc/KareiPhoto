const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i += 1) {
  const value = i / 255;
  SRGB_TO_LINEAR[i] = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** @param {number} value */
function linearToSrgbByte(value) {
  const clamped = Math.max(0, Math.min(1, value));
  const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

/**
 * Linear-light area resampling. Unlike bilinear interpolation over sRGB bytes,
 * this preserves average light energy and integrates all source texels when an
 * odd-sized mip level is reduced.
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} targetWidth
 * @param {number} targetHeight
 */
export function resizeAreaLinearLight(rgba, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (rgba.length !== sourceWidth * sourceHeight * 4) throw new RangeError('RGBA length does not match dimensions.');
  if (targetWidth < 1 || targetHeight < 1) throw new RangeError('Target dimensions must be positive.');

  // Horizontal pass stores linear RGB and straight alpha.
  const horizontal = new Float64Array(targetWidth * sourceHeight * 4);
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const start = tx * sourceWidth / targetWidth;
      const end = (tx + 1) * sourceWidth / targetWidth;
      const first = Math.floor(start);
      const last = Math.min(sourceWidth - 1, Math.ceil(end) - 1);
      const destination = (y * targetWidth + tx) * 4;
      let totalWeight = 0;
      for (let sx = first; sx <= last; sx += 1) {
        const weight = Math.max(0, Math.min(end, sx + 1) - Math.max(start, sx));
        const source = (y * sourceWidth + sx) * 4;
        horizontal[destination] += SRGB_TO_LINEAR[rgba[source]] * weight;
        horizontal[destination + 1] += SRGB_TO_LINEAR[rgba[source + 1]] * weight;
        horizontal[destination + 2] += SRGB_TO_LINEAR[rgba[source + 2]] * weight;
        horizontal[destination + 3] += (rgba[source + 3] / 255) * weight;
        totalWeight += weight;
      }
      for (let channel = 0; channel < 4; channel += 1) horizontal[destination + channel] /= totalWeight;
    }
  }

  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const start = ty * sourceHeight / targetHeight;
    const end = (ty + 1) * sourceHeight / targetHeight;
    const first = Math.floor(start);
    const last = Math.min(sourceHeight - 1, Math.ceil(end) - 1);
    for (let x = 0; x < targetWidth; x += 1) {
      const destination = (ty * targetWidth + x) * 4;
      const sum = [0, 0, 0, 0];
      let totalWeight = 0;
      for (let sy = first; sy <= last; sy += 1) {
        const weight = Math.max(0, Math.min(end, sy + 1) - Math.max(start, sy));
        const source = (sy * targetWidth + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) sum[channel] += horizontal[source + channel] * weight;
        totalWeight += weight;
      }
      output[destination] = linearToSrgbByte(sum[0] / totalWeight);
      output[destination + 1] = linearToSrgbByte(sum[1] / totalWeight);
      output[destination + 2] = linearToSrgbByte(sum[2] / totalWeight);
      output[destination + 3] = Math.round(255 * sum[3] / totalWeight);
    }
  }
  return output;
}

/** @param {Uint8Array|Uint8ClampedArray} baseRgba @param {number} width @param {number} height */
export function generateMipChain(baseRgba, width, height) {
  const levels = [{ width, height, rgba: new Uint8ClampedArray(baseRgba) }];
  while (width > 1 || height > 1) {
    const targetWidth = Math.max(1, Math.floor(width / 2));
    const targetHeight = Math.max(1, Math.floor(height / 2));
    const rgba = resizeAreaLinearLight(levels.at(-1).rgba, width, height, targetWidth, targetHeight);
    levels.push({ width: targetWidth, height: targetHeight, rgba });
    width = targetWidth;
    height = targetHeight;
  }
  return levels;
}

/** Resize to maximum long edge and crop centrally to multiples of four. */
export function fittedCroppedDimensions(sourceWidth, sourceHeight, maxLongEdge) {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight)
    || sourceWidth < 1 || sourceHeight < 1) {
    throw new RangeError('Source dimensions must be positive integers.');
  }
  if (!Number.isFinite(maxLongEdge) || maxLongEdge < 4) {
    throw new RangeError('Maximum long edge must be at least four pixels.');
  }
  const scale = Math.min(1, maxLongEdge / Math.max(sourceWidth, sourceHeight));
  const resizedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const resizedHeight = Math.max(1, Math.round(sourceHeight * scale));
  const width = resizedWidth - (resizedWidth % 4);
  const height = resizedHeight - (resizedHeight % 4);
  if (width < 4 || height < 4) {
    throw new RangeError('Image is too narrow to crop to four-pixel BC1 dimensions without distortion.');
  }
  return {
    resizedWidth,
    resizedHeight,
    width,
    height,
    cropX: Math.floor((resizedWidth - width) / 2),
    cropY: Math.floor((resizedHeight - height) / 2),
  };
}
