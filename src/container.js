import { bc1MipChainByteLength } from './bc1.js';

export const CONTAINER_MAGIC = 'KPHO';
export const CONTAINER_VERSION = 1;
export const FILE_HEADER_BYTES = 7;
export const IMAGE_HEADER_BYTES = 8;

/** @param {Array<{width:number,height:number,data:Uint8Array}>} images */
export function createKareiPhotoContainer(images) {
  if (images.length < 1) throw new RangeError('Container needs at least one image.');
  if (images.length > 0xffff) throw new RangeError('Image count exceeds uint16.');
  let total = FILE_HEADER_BYTES;
  for (const image of images) {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height)
      || image.width < 4 || image.width > 0xffff || image.height < 4 || image.height > 0xffff
      || image.width % 4 !== 0 || image.height % 4 !== 0) {
      throw new RangeError('Base image dimensions must be multiples of four that fit uint16.');
    }
    const expectedLength = bc1MipChainByteLength(image.width, image.height);
    if (image.data.byteLength !== expectedLength) {
      throw new RangeError(`BC1 mip chain is ${image.data.byteLength} bytes; expected ${expectedLength}.`);
    }
    total += IMAGE_HEADER_BYTES + image.data.byteLength;
  }
  const output = new Uint8Array(total);
  output.set(new TextEncoder().encode(CONTAINER_MAGIC), 0);
  const view = new DataView(output.buffer);
  view.setUint8(4, CONTAINER_VERSION);
  view.setUint16(5, images.length, true);
  let offset = FILE_HEADER_BYTES;
  for (const image of images) {
    view.setUint16(offset, image.width, true);
    view.setUint16(offset + 2, image.height, true);
    view.setUint32(offset + 4, image.data.byteLength, true);
    output.set(image.data, offset + IMAGE_HEADER_BYTES);
    offset += IMAGE_HEADER_BYTES + image.data.byteLength;
  }
  return output;
}

/** @param {Uint8Array} bytes */
export function parseKareiPhotoContainer(bytes) {
  if (bytes.byteLength < FILE_HEADER_BYTES) throw new RangeError('Container header is truncated.');
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== CONTAINER_MAGIC) throw new Error(`Unexpected magic: ${magic}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(4);
  if (version !== CONTAINER_VERSION) throw new Error(`Unsupported version: ${version}`);
  const imageCount = view.getUint16(5, true);
  const images = [];
  let offset = FILE_HEADER_BYTES;
  for (let index = 0; index < imageCount; index += 1) {
    if (offset + IMAGE_HEADER_BYTES > bytes.byteLength) throw new RangeError('Image header is truncated.');
    const width = view.getUint16(offset, true);
    const height = view.getUint16(offset + 2, true);
    const length = view.getUint32(offset + 4, true);
    offset += IMAGE_HEADER_BYTES;
    if (width < 4 || height < 4 || width % 4 !== 0 || height % 4 !== 0) {
      throw new RangeError('Base image dimensions must be positive multiples of four.');
    }
    const expectedLength = bc1MipChainByteLength(width, height);
    if (length !== expectedLength) {
      throw new RangeError(`BC1 mip chain is ${length} bytes; expected ${expectedLength}.`);
    }
    if (offset + length > bytes.byteLength) throw new RangeError('Image data is truncated.');
    images.push({ width, height, data: bytes.slice(offset, offset + length) });
    offset += length;
  }
  if (offset !== bytes.byteLength) throw new RangeError('Container has trailing bytes.');
  return { version, images };
}
