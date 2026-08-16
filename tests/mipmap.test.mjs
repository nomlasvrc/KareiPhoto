import test from 'node:test';
import assert from 'node:assert/strict';
import { fittedCroppedDimensions, generateMipChain, resizeAreaLinearLight } from '../src/mipmap.js';

test('mip chain follows Unity floor-halving down to 1x1', () => {
  const rgba = new Uint8ClampedArray(12 * 8 * 4).fill(255);
  const levels = generateMipChain(rgba, 12, 8);
  assert.deepEqual(levels.map(({ width, height }) => [width, height]), [[12, 8], [6, 4], [3, 2], [1, 1]]);
});

test('linear-light averaging is brighter than averaging sRGB bytes', () => {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 255, 255, 255, 255, 255,
    0, 0, 0, 255, 255, 255, 255, 255,
  ]);
  const result = resizeAreaLinearLight(rgba, 2, 2, 1, 1);
  assert.ok(result[0] >= 187 && result[0] <= 189);
  assert.equal(result[3], 255);
});

test('central crop removes odd remainder from right and bottom first', () => {
  assert.deepEqual(fittedCroppedDimensions(101, 99, 200), {
    resizedWidth: 101, resizedHeight: 99, width: 100, height: 96, cropX: 0, cropY: 1,
  });
});

test('dimension fitting rejects images that would need aspect-ratio distortion', () => {
  assert.throws(() => fittedCroppedDimensions(1, 1000, 512), /too narrow/);
});
