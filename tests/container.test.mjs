import test from 'node:test';
import assert from 'node:assert/strict';
import { createKareiPhotoContainer, parseKareiPhotoContainer } from '../src/container.js';

test('KPHO v1 round trips and uses little endian fields', () => {
  const bytes = createKareiPhotoContainer([
    { width: 8, height: 4, data: new Uint8Array(40).fill(0x11) },
    { width: 4, height: 4, data: new Uint8Array(24).fill(0xaa) },
  ]);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'KPHO');
  assert.deepEqual([...bytes.subarray(5, 7)], [2, 0]);
  assert.deepEqual([...bytes.subarray(7, 11)], [8, 0, 4, 0]);
  const parsed = parseKareiPhotoContainer(bytes);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.images.length, 2);
  assert.deepEqual([...parsed.images[1].data], new Array(24).fill(0xaa));
});

test('parser rejects truncation and trailing bytes', () => {
  const valid = createKareiPhotoContainer([{ width: 4, height: 4, data: new Uint8Array(24) }]);
  assert.throws(() => parseKareiPhotoContainer(valid.subarray(0, valid.length - 1)), /truncated/);
  const trailing = new Uint8Array(valid.length + 1);
  trailing.set(valid);
  assert.throws(() => parseKareiPhotoContainer(trailing), /trailing/);
});

test('writer and parser reject records that cannot be loaded as the declared BC1 mip chain', () => {
  assert.throws(() => createKareiPhotoContainer([]), /at least one/);
  assert.throws(
    () => createKareiPhotoContainer([{ width: 4, height: 4, data: new Uint8Array(8) }]),
    /expected 24/,
  );

  const valid = createKareiPhotoContainer([{ width: 4, height: 4, data: new Uint8Array(24) }]);
  const wrongLength = valid.slice();
  new DataView(wrongLength.buffer).setUint32(11, 8, true);
  assert.throws(() => parseKareiPhotoContainer(wrongLength), /expected 24/);
});
