import { decodeBc1, encodeBc1 } from './bc1.js';
import { generateMipChain } from './mipmap.js';

self.onmessage = (event) => {
  const { id, rgbaBuffer, width, height, quality } = event.data;
  try {
    const rgba = new Uint8ClampedArray(rgbaBuffer);
    const levels = generateMipChain(rgba, width, height);
    const encodedLevels = levels.map((level) => encodeBc1(level.rgba, level.width, level.height, {
      quality,
      // Browser ImageData is top-down; Unity raw texture rows start at bottom-left.
      flipY: true,
    }));
    const byteLength = encodedLevels.reduce((sum, level) => sum + level.byteLength, 0);
    const data = new Uint8Array(byteLength);
    let offset = 0;
    for (const level of encodedLevels) {
      data.set(level, offset);
      offset += level.byteLength;
    }
    const decoded = decodeBc1(encodedLevels[0], width, height, { flipY: true });
    self.postMessage({
      id,
      ok: true,
      dataBuffer: data.buffer,
      decodedBuffer: decoded.buffer,
    }, [data.buffer, decoded.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
