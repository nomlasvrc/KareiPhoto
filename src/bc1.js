/**
 * Dependency-free opaque BC1 (DXT1) encoder/decoder.
 *
 * The quality path uses several endpoint seeds, PCA, selector assignment,
 * least-squares endpoint refinement and a small RGB565 neighbourhood search.
 * Alpha is deliberately ignored and every block is emitted in four-colour mode.
 */

const METRIC = [0.299, 0.587, 0.114];
const SELECTOR_WEIGHTS = [
  [1, 0],
  [0, 1],
  [2 / 3, 1 / 3],
  [1 / 3, 2 / 3],
];

/** @param {number} value */
function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** @param {number} r @param {number} g @param {number} b */
export function packRgb565(r, g, b) {
  return ((Math.round(clampByte(r) * 31 / 255) << 11)
    | (Math.round(clampByte(g) * 63 / 255) << 5)
    | Math.round(clampByte(b) * 31 / 255)) >>> 0;
}

/** @param {number} value */
export function unpackRgb565(value) {
  const r5 = (value >>> 11) & 31;
  const g6 = (value >>> 5) & 63;
  const b5 = value & 31;
  return [
    (r5 << 3) | (r5 >>> 2),
    (g6 << 2) | (g6 >>> 4),
    (b5 << 3) | (b5 >>> 2),
  ];
}

/** @param {number} endpoint0 @param {number} endpoint1 */
function paletteFor(endpoint0, endpoint1) {
  const a = unpackRgb565(endpoint0);
  const b = unpackRgb565(endpoint1);
  return [
    a,
    b,
    [
      Math.floor((2 * a[0] + b[0]) / 3),
      Math.floor((2 * a[1] + b[1]) / 3),
      Math.floor((2 * a[2] + b[2]) / 3),
    ],
    [
      Math.floor((a[0] + 2 * b[0]) / 3),
      Math.floor((a[1] + 2 * b[1]) / 3),
      Math.floor((a[2] + 2 * b[2]) / 3),
    ],
  ];
}

/** @param {Float64Array} block @param {number[][]} palette */
function assignSelectors(block, palette) {
  let bits = 0;
  let error = 0;
  const selectors = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    const offset = i * 3;
    let bestIndex = 0;
    let bestError = Number.POSITIVE_INFINITY;
    for (let p = 0; p < 4; p += 1) {
      const dr = block[offset] - palette[p][0];
      const dg = block[offset + 1] - palette[p][1];
      const db = block[offset + 2] - palette[p][2];
      const candidateError = METRIC[0] * dr * dr + METRIC[1] * dg * dg + METRIC[2] * db * db;
      if (candidateError < bestError) {
        bestError = candidateError;
        bestIndex = p;
      }
    }
    selectors[i] = bestIndex;
    bits = (bits | (bestIndex << (i * 2))) >>> 0;
    error += bestError;
  }
  return { bits, error, selectors };
}

/** @param {number} endpoint0 @param {number} endpoint1 */
function forceFourColour(endpoint0, endpoint1) {
  let a = endpoint0;
  let b = endpoint1;
  if (a < b) [a, b] = [b, a];
  if (a === b) {
    if (a < 0xffff) a += 1;
    else b -= 1;
  }
  return [a, b];
}

/** @param {Float64Array} block @param {number[]} start0 @param {number[]} start1 @param {number} iterations */
function refineSeed(block, start0, start1, iterations) {
  let [endpoint0, endpoint1] = forceFourColour(
    packRgb565(start0[0], start0[1], start0[2]),
    packRgb565(start1[0], start1[1], start1[2]),
  );
  let assignment = assignSelectors(block, paletteFor(endpoint0, endpoint1));
  let best = { endpoint0, endpoint1, ...assignment };

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let aa = 0;
    let ab = 0;
    let bb = 0;
    const rhsA = [0, 0, 0];
    const rhsB = [0, 0, 0];
    for (let i = 0; i < 16; i += 1) {
      const [a, b] = SELECTOR_WEIGHTS[assignment.selectors[i]];
      aa += a * a;
      ab += a * b;
      bb += b * b;
      const offset = i * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        rhsA[channel] += a * block[offset + channel];
        rhsB[channel] += b * block[offset + channel];
      }
    }
    const determinant = aa * bb - ab * ab;
    if (Math.abs(determinant) < 1e-9) break;
    const next0 = [0, 0, 0];
    const next1 = [0, 0, 0];
    for (let channel = 0; channel < 3; channel += 1) {
      next0[channel] = clampByte((rhsA[channel] * bb - rhsB[channel] * ab) / determinant);
      next1[channel] = clampByte((rhsB[channel] * aa - rhsA[channel] * ab) / determinant);
    }
    [endpoint0, endpoint1] = forceFourColour(
      packRgb565(next0[0], next0[1], next0[2]),
      packRgb565(next1[0], next1[1], next1[2]),
    );
    assignment = assignSelectors(block, paletteFor(endpoint0, endpoint1));
    if (assignment.error + 1e-9 < best.error) best = { endpoint0, endpoint1, ...assignment };
    else if (assignment.bits === best.bits) break;
  }
  return best;
}

/** @param {number} endpoint @param {number} component @param {number} delta */
function perturb565(endpoint, component, delta) {
  const shifts = [11, 5, 0];
  const maxima = [31, 63, 31];
  const shift = shifts[component];
  const mask = maxima[component];
  const value = Math.max(0, Math.min(mask, ((endpoint >>> shift) & mask) + delta));
  return ((endpoint & ~(mask << shift)) | (value << shift)) >>> 0;
}

/** @param {Float64Array} block @param {{endpoint0:number, endpoint1:number, bits:number, error:number, selectors:Uint8Array}} initial @param {number} passes */
function localSearch(block, initial, passes) {
  let best = initial;
  for (let pass = 0; pass < passes; pass += 1) {
    let improved = false;
    for (let which = 0; which < 2; which += 1) {
      for (let component = 0; component < 3; component += 1) {
        for (const delta of [-1, 1]) {
          let endpoint0 = best.endpoint0;
          let endpoint1 = best.endpoint1;
          if (which === 0) endpoint0 = perturb565(endpoint0, component, delta);
          else endpoint1 = perturb565(endpoint1, component, delta);
          [endpoint0, endpoint1] = forceFourColour(endpoint0, endpoint1);
          const assignment = assignSelectors(block, paletteFor(endpoint0, endpoint1));
          if (assignment.error + 1e-9 < best.error) {
            best = { endpoint0, endpoint1, ...assignment };
            improved = true;
          }
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

/** @param {Float64Array} block */
function endpointSeeds(block) {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  const mean = [0, 0, 0];
  let darkest = [0, 0, 0];
  let lightest = [0, 0, 0];
  let minLuma = Number.POSITIVE_INFINITY;
  let maxLuma = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 16; i += 1) {
    const offset = i * 3;
    const colour = [block[offset], block[offset + 1], block[offset + 2]];
    const luma = METRIC[0] * colour[0] + METRIC[1] * colour[1] + METRIC[2] * colour[2];
    for (let c = 0; c < 3; c += 1) {
      min[c] = Math.min(min[c], colour[c]);
      max[c] = Math.max(max[c], colour[c]);
      mean[c] += colour[c] / 16;
    }
    if (luma < minLuma) { minLuma = luma; darkest = colour; }
    if (luma > maxLuma) { maxLuma = luma; lightest = colour; }
  }

  // Power iteration over the RGB covariance matrix gives the principal axis.
  const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 16; i += 1) {
    const offset = i * 3;
    const delta = [block[offset] - mean[0], block[offset + 1] - mean[1], block[offset + 2] - mean[2]];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) covariance[row][column] += delta[row] * delta[column];
    }
  }
  let axis = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const next = [
      covariance[0][0] * axis[0] + covariance[0][1] * axis[1] + covariance[0][2] * axis[2],
      covariance[1][0] * axis[0] + covariance[1][1] * axis[1] + covariance[1][2] * axis[2],
      covariance[2][0] * axis[0] + covariance[2][1] * axis[1] + covariance[2][2] * axis[2],
    ];
    const length = Math.hypot(next[0], next[1], next[2]);
    if (length < 1e-9) break;
    axis = next.map((value) => value / length);
  }
  let lowProjection = Number.POSITIVE_INFINITY;
  let highProjection = Number.NEGATIVE_INFINITY;
  let low = min;
  let high = max;
  for (let i = 0; i < 16; i += 1) {
    const offset = i * 3;
    const projection = (block[offset] - mean[0]) * axis[0]
      + (block[offset + 1] - mean[1]) * axis[1]
      + (block[offset + 2] - mean[2]) * axis[2];
    if (projection < lowProjection) {
      lowProjection = projection;
      low = [block[offset], block[offset + 1], block[offset + 2]];
    }
    if (projection > highProjection) {
      highProjection = projection;
      high = [block[offset], block[offset + 1], block[offset + 2]];
    }
  }
  const inset = min.map((value, channel) => value + (max[channel] - value) / 16);
  const outset = max.map((value, channel) => value - (value - min[channel]) / 16);
  return [[max, min], [high, low], [lightest, darkest], [outset, inset]];
}

/**
 * @param {Float64Array} block sixteen RGB triples
 * @param {'fast'|'quality'} quality
 */
export function encodeBc1Block(block, quality = 'quality') {
  const seeds = endpointSeeds(block);
  const count = quality === 'quality' ? seeds.length : 1;
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const candidate = refineSeed(block, seeds[i][0], seeds[i][1], quality === 'quality' ? 6 : 2);
    if (!best || candidate.error < best.error) best = candidate;
  }
  if (quality === 'quality') best = localSearch(block, best, 2);
  return best;
}

/** @param {Uint8Array|Uint8ClampedArray} rgba @param {number} width @param {number} height @param {{quality?:'fast'|'quality', flipY?:boolean}} options */
export function encodeBc1(rgba, width, height, options = {}) {
  if (rgba.length !== width * height * 4) throw new RangeError('RGBA length does not match dimensions.');
  const quality = options.quality ?? 'quality';
  const flipY = options.flipY ?? false;
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  const output = new Uint8Array(blocksWide * blocksHigh * 8);
  const view = new DataView(output.buffer);
  const block = new Float64Array(16 * 3);
  let outputOffset = 0;
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      for (let py = 0; py < 4; py += 1) {
        const rawY = Math.min(height - 1, blockY * 4 + py);
        const sourceY = flipY ? height - 1 - rawY : rawY;
        for (let px = 0; px < 4; px += 1) {
          const sourceX = Math.min(width - 1, blockX * 4 + px);
          const sourceOffset = (sourceY * width + sourceX) * 4;
          const blockOffset = (py * 4 + px) * 3;
          block[blockOffset] = rgba[sourceOffset];
          block[blockOffset + 1] = rgba[sourceOffset + 1];
          block[blockOffset + 2] = rgba[sourceOffset + 2];
        }
      }
      const encoded = encodeBc1Block(block, quality);
      view.setUint16(outputOffset, encoded.endpoint0, true);
      view.setUint16(outputOffset + 2, encoded.endpoint1, true);
      view.setUint32(outputOffset + 4, encoded.bits, true);
      outputOffset += 8;
    }
  }
  return output;
}

/** @param {Uint8Array} data @param {number} width @param {number} height @param {{flipY?:boolean}} options */
export function decodeBc1(data, width, height, options = {}) {
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  const expected = blocksWide * blocksHigh * 8;
  if (data.byteLength < expected) throw new RangeError(`BC1 data needs ${expected} bytes.`);
  const flipY = options.flipY ?? false;
  const output = new Uint8ClampedArray(width * height * 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let inputOffset = 0;
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const endpoint0 = view.getUint16(inputOffset, true);
      const endpoint1 = view.getUint16(inputOffset + 2, true);
      const palette = paletteFor(endpoint0, endpoint1);
      const bits = view.getUint32(inputOffset + 4, true);
      for (let py = 0; py < 4; py += 1) {
        const rawY = blockY * 4 + py;
        if (rawY >= height) continue;
        const outputY = flipY ? height - 1 - rawY : rawY;
        for (let px = 0; px < 4; px += 1) {
          const x = blockX * 4 + px;
          if (x >= width) continue;
          const selector = (bits >>> ((py * 4 + px) * 2)) & 3;
          const offset = (outputY * width + x) * 4;
          output[offset] = palette[selector][0];
          output[offset + 1] = palette[selector][1];
          output[offset + 2] = palette[selector][2];
          output[offset + 3] = 255;
        }
      }
      inputOffset += 8;
    }
  }
  return output;
}

export function bc1LevelByteLength(width, height) {
  return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * 8;
}

export function bc1MipChainByteLength(width, height) {
  let total = 0;
  while (true) {
    total += bc1LevelByteLength(width, height);
    if (width === 1 && height === 1) return total;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
}
