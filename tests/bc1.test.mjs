import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bc1LevelByteLength,
  bc1MipChainByteLength,
  decodeBc1,
  encodeBc1,
  packRgb565,
  unpackRgb565,
} from '../src/bc1.js';
import { imageMetrics } from '../src/metrics.js';

function proceduralImage(width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = (x * 7 + y * 3 + 24 * Math.sin(y / 3)) & 255;
      rgba[offset + 1] = (x * 2 + y * 8 + 18 * Math.cos(x / 5)) & 255;
      rgba[offset + 2] = (x * 5 + y * 5 + ((x ^ y) & 15) * 3) & 255;
      rgba[offset + 3] = (x * 13 + y * 17) & 255;
    }
  }
  return rgba;
}

test('RGB565 packing uses standard bit layout', () => {
  assert.equal(packRgb565(255, 0, 0), 0xf800);
  assert.equal(packRgb565(0, 255, 0), 0x07e0);
  assert.equal(packRgb565(0, 0, 255), 0x001f);
  assert.deepEqual(unpackRgb565(0xffff), [255, 255, 255]);
});

test('BC1 lengths include one full block for tiny mips', () => {
  assert.equal(bc1LevelByteLength(1, 1), 8);
  assert.equal(bc1LevelByteLength(8, 5), 32);
  assert.equal(bc1MipChainByteLength(12, 8), 80);
});

test('encoder emits opaque four-colour blocks and ignores alpha', () => {
  const image = proceduralImage(8, 8);
  const withRandomAlpha = encodeBc1(image, 8, 8);
  for (let offset = 3; offset < image.length; offset += 4) image[offset] = 255;
  const opaque = encodeBc1(image, 8, 8);
  assert.deepEqual(withRandomAlpha, opaque);
  const view = new DataView(opaque.buffer);
  for (let offset = 0; offset < opaque.length; offset += 8) {
    assert.ok(view.getUint16(offset, true) > view.getUint16(offset + 2, true));
  }
});

test('Unity flip is reversible for asymmetric content', () => {
  const width = 8;
  const height = 8;
  const image = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      image.set(y < 4 ? [240, 20, 10, 255] : [5, 40, 230, 255], offset);
    }
  }
  const encoded = encodeBc1(image, width, height, { flipY: true });
  const decoded = decodeBc1(encoded, width, height, { flipY: true });
  assert.ok(decoded[0] > decoded[2]);
  const bottom = ((height - 1) * width) * 4;
  assert.ok(decoded[bottom + 2] > decoded[bottom]);
});

test('quality mode is never worse than fast mode on a photo-like sample', () => {
  const width = 32;
  const height = 28;
  const image = proceduralImage(width, height);
  const fast = decodeBc1(encodeBc1(image, width, height, { quality: 'fast' }), width, height);
  const quality = decodeBc1(encodeBc1(image, width, height, { quality: 'quality' }), width, height);
  const fastMetric = imageMetrics(image, fast);
  const qualityMetric = imageMetrics(image, quality);
  assert.ok(qualityMetric.perceptualMse <= fastMetric.perceptualMse + 1e-9);
});
