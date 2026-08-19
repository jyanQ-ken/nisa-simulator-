const CACHE_NAME = 'nisa-sim-v30';
const ASSETS = [
  './index.html',
  './style.css?v=30',
  './script.js?v=30',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './og-image.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ネットにつながっている時は常に最新版を取りに行き、キャッシュも更新しておく。
// オフラインの時だけ、保存しておいたキャッシュを使う。
// (以前は「キャッシュ優先」だったため、更新しても古い画面のまま固定されることがあった)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
