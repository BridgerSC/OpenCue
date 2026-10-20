/* OpenCue service worker: lets the installed app open without internet.
 * Network first, so everyone gets the newest version when online; the cached
 * copy is only used when the network is unavailable. Only OpenCue's own files
 * are cached. Scripts are never here: they live in each browser's own storage. */
'use strict';

const CACHE = 'opencue-v1';
const APP_FILES = [
  './',
  'index.html',
  'remote.html',
  'manifest.webmanifest',
  'css/style.css',
  'css/fonts/inter-latin-wght-normal.woff2',
  'js/parser.js',
  'js/tracker.js',
  'js/voice.js',
  'js/prompter.js',
  'js/link.js',
  'js/app.js',
  'js/remote.js',
  'js/vendor/peerjs.min.js',
  'js/vendor/qrcode.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_FILES.map((f) => new URL(f, self.registration.scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('opencue-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (_) {
      const hit = await cache.match(req, { ignoreSearch: true }) ||
        (req.mode === 'navigate' ? await cache.match(new URL('index.html', self.registration.scope).href) : null);
      return hit || Response.error();
    }
  })());
});
