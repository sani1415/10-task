/**
 * Entry-page PWA prototype: precaches landing shell only.
 * teacher.html / student.html stay online-first until full-app PWA.
 */
var CACHE_NAME = 'waqful-entry-v1';
var PRECACHE = [
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE.map(function (p) {
        return new URL(p, self.location).toString();
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) {
          return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request)
          .then(function (res) {
            return res;
          })
          .catch(function () {
            if (e.request.mode !== 'navigate') return Promise.reject();
            var path = url.pathname || '';
            var isEntry = path === '/' || /index\.html$/i.test(path);
            if (!isEntry) return Promise.reject();
            return cache.match(new URL('./index.html', self.location.origin));
          });
      });
    })
  );
});
