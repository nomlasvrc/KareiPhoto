const CACHE = 'karei-photo-v5';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './assets/icon.svg',
  './src/app.js?v=5', './src/worker.js', './src/bc1.js', './src/mipmap.js', './src/container.js', './src/metrics.js',
];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
