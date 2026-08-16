/** @param {Uint8Array|Uint8ClampedArray} original @param {Uint8Array|Uint8ClampedArray} decoded */
export function imageMetrics(original, decoded) {
  if (original.length !== decoded.length) throw new RangeError('Images must have the same length.');
  let squaredError = 0;
  let weightedSquaredError = 0;
  const pixels = original.length / 4;
  for (let offset = 0; offset < original.length; offset += 4) {
    const dr = original[offset] - decoded[offset];
    const dg = original[offset + 1] - decoded[offset + 1];
    const db = original[offset + 2] - decoded[offset + 2];
    squaredError += dr * dr + dg * dg + db * db;
    weightedSquaredError += 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
  }
  const mse = squaredError / (pixels * 3);
  const perceptualMse = weightedSquaredError / pixels;
  return {
    mse,
    perceptualMse,
    psnr: mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10(255 * 255 / mse),
    perceptualPsnr: perceptualMse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10(255 * 255 / perceptualMse),
  };
}
