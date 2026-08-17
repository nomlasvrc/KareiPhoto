import { bc1MipChainByteLength } from './bc1.js';
import { createKareiPhotoContainer } from './container.js';
import { fittedCroppedDimensions } from './mipmap.js';

const fileInput = document.querySelector('#files');
const dropZone = document.querySelector('#drop-zone');
const encodeButton = document.querySelector('#encode');
const downloadButton = document.querySelector('#download');
const clearButton = document.querySelector('#clear');
const resultsElement = document.querySelector('#results');
const summaryElement = document.querySelector('#summary');
const installButton = document.querySelector('#install');
const maxEdgeSelect = document.querySelector('#max-edge');
const qualitySelect = document.querySelector('#quality');
const SIZE_WARNING_BYTES = 100 * 1024 ** 2;

/** @type {Array<{id:string,file:File,name:string,width:number,height:number,rgba:Uint8ClampedArray,card:HTMLElement}>} */
let prepared = [];
/** @type {Array<{id:string,name:string,width:number,height:number,data:Uint8Array}>} */
let encoded = [];
let installPrompt = null;
let preparationGeneration = 0;
let isEncoding = false;

const formatBytes = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2
  ? `${(bytes / 1024).toFixed(1)} KiB`
  : `${(bytes / 1024 ** 2).toFixed(2)} MiB`;

function setStatus(text, tone = '') {
  summaryElement.textContent = text;
  summaryElement.dataset.tone = tone;
}

/** @param {Array<{width:number,height:number}>} images */
function estimatedContainerByteLength(images) {
  return images.reduce(
    (sum, image) => sum + 8 + bc1MipChainByteLength(image.width, image.height),
    7,
  );
}

/** @param {number} bytes @param {'見込み'|'変換後'} phase */
function sizeWarning(bytes, phase) {
  return bytes > SIZE_WARNING_BYTES
    ? ` • 警告: ${phase}サイズが 100 MB を超えています`
    : '';
}

function trackEvent(name, parameters = {}) {
  window.gtag?.('event', name, parameters);
}

function showEmptyState() {
  const emptyState = document.createElement('p');
  emptyState.className = 'empty-state';
  emptyState.textContent = '写真を選ぶと、ここにプレビューが表示されます。';
  resultsElement.replaceChildren(emptyState);
}

function setBusy(busy) {
  fileInput.disabled = busy;
  maxEdgeSelect.disabled = busy;
  qualitySelect.disabled = busy;
  clearButton.disabled = busy;
  for (const button of resultsElement.querySelectorAll('.remove-image')) button.disabled = busy;
  dropZone.classList.toggle('disabled', busy);
  dropZone.setAttribute('aria-busy', String(busy));
}

/** @param {HTMLCanvasElement} canvas @param {Uint8Array|Uint8ClampedArray} rgba @param {number} width @param {number} height */
function paintCanvas(canvas, rgba, width, height) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
}

/** @param {File} file */
async function decodeFile(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} を読み込めません。`)); };
      image.src = url;
    });
  }
  const maxLongEdge = Number(maxEdgeSelect.value);
  const dimensions = fittedCroppedDimensions(source.width, source.height, maxLongEdge);
  const resizedCanvas = document.createElement('canvas');
  resizedCanvas.width = dimensions.resizedWidth;
  resizedCanvas.height = dimensions.resizedHeight;
  const resizedContext = resizedCanvas.getContext('2d', { willReadFrequently: true });
  resizedContext.imageSmoothingEnabled = true;
  resizedContext.imageSmoothingQuality = 'high';
  resizedContext.drawImage(source, 0, 0, dimensions.resizedWidth, dimensions.resizedHeight);
  source.close?.();
  const pixels = resizedContext.getImageData(
    dimensions.cropX,
    dimensions.cropY,
    dimensions.width,
    dimensions.height,
  ).data;
  return { ...dimensions, rgba: pixels };
}

/** @param {string} id @param {string} name @param {number} width @param {number} height @param {Uint8ClampedArray} rgba */
function createResultCard(id, name, width, height, rgba) {
  const template = document.querySelector('#result-template');
  const card = template.content.firstElementChild.cloneNode(true);
  resultsElement.querySelector('.empty-state')?.remove();
  card.querySelector('.result-name').textContent = name;
  card.querySelector('.result-meta').textContent = `${width} × ${height} • 変換後 約 ${formatBytes(bc1MipChainByteLength(width, height))}`;
  const removeButton = card.querySelector('.remove-image');
  removeButton.setAttribute('aria-label', `${name} を削除`);
  removeButton.title = `${name} を削除`;
  removeButton.addEventListener('click', () => removeImage(id));
  paintCanvas(card.querySelector('.original'), rgba, width, height);
  card.querySelector('.result-state').textContent = '待機中';
  resultsElement.append(card);
  return card;
}

function updatePreparedStatus() {
  if (!prepared.length) {
    encoded = [];
    showEmptyState();
    encodeButton.disabled = true;
    downloadButton.disabled = true;
    setStatus('写真を選択すると、ここに変換後のサイズが表示されます。');
    return;
  }

  encodeButton.disabled = false;
  const estimate = estimatedContainerByteLength(prepared);
  const warning = sizeWarning(estimate, '見込み');
  setStatus(
    `${prepared.length} 枚を準備しました • 変換後 約 ${formatBytes(estimate)}${warning}`,
    warning ? 'warning' : '',
  );
}

/** @param {string} id */
function removeImage(id) {
  if (isEncoding) return;
  const index = prepared.findIndex((image) => image.id === id);
  if (index < 0) return;

  prepared[index].card.remove();
  prepared.splice(index, 1);
  encoded = encoded.filter((image) => image.id !== id);

  if (!prepared.length || encoded.length !== prepared.length) {
    if (encoded.length) resetConversion();
    updatePreparedStatus();
    return;
  }

  const container = createKareiPhotoContainer(encoded);
  const warning = sizeWarning(container.byteLength, '変換後');
  downloadButton.disabled = false;
  setStatus(
    `${encoded.length} 枚の変換が完了しました • ${formatBytes(container.byteLength)}${warning}`,
    warning ? 'warning' : 'success',
  );
}

async function prepareFiles(files) {
  // FileList is live: copy it before resetAll() resets the file input.
  const candidates = [...files];
  const generation = ++preparationGeneration;
  resetAll();
  const images = candidates.filter((file) => file.type.startsWith('image/')
    || /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name));
  if (!images.length) return setStatus('画像ファイルを選択してください。', 'error');
  setBusy(true);
  setStatus(`${images.length} 枚を読み込んでいます…`);
  let failures = 0;
  for (const [index, file] of images.entries()) {
    try {
      const image = await decodeFile(file);
      if (generation !== preparationGeneration) return;
      const id = `${generation}-${index}`;
      const card = createResultCard(id, file.name, image.width, image.height, image.rgba);
      prepared.push({ id, file, name: file.name, ...image, card });
    } catch (error) {
      failures += 1;
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  if (generation !== preparationGeneration) return;
  setBusy(false);
  if (prepared.length) {
    encodeButton.disabled = false;
    const estimate = estimatedContainerByteLength(prepared);
    const suffix = failures ? `（${failures} 枚は読み込めませんでした）` : '';
    const warning = sizeWarning(estimate, '見込み');
    setStatus(
      `${prepared.length} 枚を準備しました • 変換後 約 ${formatBytes(estimate)}${warning} ${suffix}`,
      failures ? 'error' : warning ? 'warning' : '',
    );
    trackEvent('images_prepared', {
      image_count: prepared.length,
      estimated_output_bytes: estimate,
      max_edge: Number(maxEdgeSelect.value),
    });
  } else {
    showEmptyState();
  }
}

/** @param {typeof prepared[number]} image @param {'fast'|'quality'} quality */
function encodeOne(image, quality) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const copy = image.rgba.slice();
    worker.onmessage = (event) => {
      worker.terminate();
      if (!event.data.ok) return reject(new Error(event.data.error));
      resolve(event.data);
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({
      id: image.id,
      rgbaBuffer: copy.buffer,
      width: image.width,
      height: image.height,
      quality,
    }, [copy.buffer]);
  });
}

async function runEncoding() {
  if (isEncoding || !prepared.length) return;
  const quality = qualitySelect.value;
  trackEvent('conversion_started', {
    image_count: prepared.length,
    max_edge: Number(maxEdgeSelect.value),
    quality,
  });
  encoded = [];
  isEncoding = true;
  setBusy(true);
  encodeButton.disabled = true;
  downloadButton.disabled = true;
  // Process sequentially to keep peak memory predictable on mobile PWAs.
  for (const [index, image] of prepared.entries()) {
    image.card.querySelector('.result-state').textContent = '変換中…';
    setStatus(`${index + 1} / ${prepared.length}: ${image.name} を変換しています…`);
    try {
      const result = await encodeOne(image, quality);
      const data = new Uint8Array(result.dataBuffer);
      const decoded = new Uint8ClampedArray(result.decodedBuffer);
      encoded.push({ id: image.id, name: image.name, width: image.width, height: image.height, data });
      paintCanvas(image.card.querySelector('.decoded'), decoded, image.width, image.height);
      image.card.querySelector('.result-state').textContent = `変換完了 • ${formatBytes(data.byteLength)}`;
      image.card.classList.add('complete');
    } catch (error) {
      image.card.querySelector('.result-state').textContent = error instanceof Error ? error.message : String(error);
      image.card.classList.add('failed');
    }
  }
  isEncoding = false;
  setBusy(false);
  encodeButton.disabled = false;
  if (encoded.length === prepared.length) {
    downloadButton.disabled = false;
    const container = createKareiPhotoContainer(encoded);
    const warning = sizeWarning(container.byteLength, '変換後');
    setStatus(
      `${encoded.length} 枚の変換が完了しました • ${formatBytes(container.byteLength)}${warning}`,
      warning ? 'warning' : 'success',
    );
    trackEvent('conversion_completed', {
      image_count: encoded.length,
      output_bytes: container.byteLength,
      max_edge: Number(maxEdgeSelect.value),
      quality,
    });
  } else {
    downloadButton.disabled = true;
    setStatus(`${prepared.length - encoded.length} 枚を変換できませんでした。設定を変えて、もう一度お試しください。`, 'error');
  }
}

function downloadPack() {
  const bytes = createKareiPhotoContainer(encoded);
  trackEvent('kphoto_download', {
    image_count: encoded.length,
    output_bytes: bytes.byteLength,
  });
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `karei-photo-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.kphoto`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetAll() {
  prepared = [];
  encoded = [];
  showEmptyState();
  fileInput.value = '';
  encodeButton.disabled = true;
  downloadButton.disabled = true;
  setStatus('写真を選択すると、ここに変換後のサイズが表示されます。');
}

function clearAll() {
  preparationGeneration += 1;
  setBusy(false);
  resetAll();
}

function resetConversion() {
  encoded = [];
  downloadButton.disabled = true;
  for (const image of prepared) {
    image.card.classList.remove('complete', 'failed');
    image.card.querySelector('.result-state').textContent = '待機中';
    const canvas = image.card.querySelector('.decoded');
    canvas.width = 0;
    canvas.height = 0;
  }
  if (prepared.length) setStatus('仕上がり設定を変更しました。もう一度変換してください。');
}

fileInput.addEventListener('change', () => prepareFiles(fileInput.files));
encodeButton.addEventListener('click', runEncoding);
downloadButton.addEventListener('click', downloadPack);
clearButton.addEventListener('click', clearAll);
maxEdgeSelect.addEventListener('change', () => {
  const files = prepared.map((image) => image.file);
  if (files.length) prepareFiles(files);
});
qualitySelect.addEventListener('change', resetConversion);
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', (event) => {
  if (!isEncoding) prepareFiles(event.dataTransfer.files);
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  await installPrompt?.prompt();
  installPrompt = null;
  installButton.hidden = true;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
