/* Waqful Madinah — full-app shell cache + Web Push display */
var CACHE = 'waqful-full-v3';

var CDN_ASSETS = [
  'https://unpkg.com/@supabase/supabase-js@2.49.8/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
];

function baseHref() {
  var p = self.location.pathname;
  var i = p.lastIndexOf('/');
  return self.location.origin + (i <= 0 ? '/' : p.slice(0, i + 1));
}

function absLocal(path) {
  return new URL(path, baseHref()).href;
}

var LOCAL_SHELL = [
  'index.html',
  'teacher.html',
  'student.html',
  'style.css',
  'api.js',
  'remote-sync-write.js',
  'remote-sync.js',
  'pdf-merge.js',
  'pwa-notify.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'supabase-config.js',
  'pwa-config.js',
].map(absLocal);

function precacheAll(cache) {
  var all = LOCAL_SHELL.concat(CDN_ASSETS);
  return Promise.all(
    all.map(function (url) {
      return cache.add(url).catch(function () {});
    })
  );
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return precacheAll(cache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(function (res) {
          var copy = res.clone();
          if (res.ok && sameOrigin(url))
            caches.open(CACHE).then(function (c) {
              c.put(e.request, copy);
            });
          return res;
        })
        .catch(function () {
          return caches.match(e.request).then(function (hit) {
            if (hit) return hit;
            var path = url.pathname || '';
            var name = path.split('/').pop() || '';
            if (path === '/' || /index\.html$/i.test(path))
              return caches.match(absLocal('index.html'));
            if (/teacher\.html$/i.test(name)) return caches.match(absLocal('teacher.html'));
            if (/student\.html$/i.test(name)) return caches.match(absLocal('student.html'));
            return caches.match(absLocal('index.html'));
          });
        })
    );
    return;
  }

  if (!sameOrigin(url)) return;

  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put(e.request, copy);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(e.request);
      })
  );
});

self.addEventListener('push', function (e) {
  var title = 'Waqful Madinah';
  var body = 'নতুন আপডেট আছে।';
  var openUrl = absLocal('index.html');
  var tag = 'waqful-push';
  if (e.data) {
    try {
      var j = e.data.json();
      if (j.title) title = j.title;
      if (j.body) body = j.body;
      if (j.url) openUrl = new URL(j.url, baseHref()).href;
      if (j.tag) tag = j.tag;
    } catch (err) {
      var t = e.data.text();
      if (t) body = t.slice(0, 200);
    }
  }
  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: absLocal('icons/icon-192.png'),
      badge: absLocal('icons/icon-192.png'),
      tag: tag,
      renotify: true,
      silent: false,
      vibrate: [200, 100, 200],
      data: { url: openUrl },
    }).then(function () {
      if ('setAppBadge' in navigator) return navigator.setAppBadge(1);
    })
  );
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  if ('clearAppBadge' in navigator) navigator.clearAppBadge();
  var url = (e.notification.data && e.notification.data.url) || absLocal('index.html');
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
