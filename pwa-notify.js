/* Waqful Madinah — PWA: SW registration, Web Push subscribe, foreground sync hints */
(function (w) {
  var lastForegroundNotify = 0;
  var MIN_GAP_MS = 40000;

  function urlB64ToUint8Array(base64String) {
    var padLen = (4 - (base64String.length % 4)) % 4;
    var padding = '';
    for (var p = 0; p < padLen; p++) padding += '=';
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  function register() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register('sw.js').catch(function () {
      return null;
    });
  }

  function saveSubscriptionToRemote(role, studentWaqf, subJson) {
    var RS = w.RemoteSync;
    if (!RS || !RS.isRemote || !RS.isRemote() || !RS.flushKey) return Promise.resolve();
    var sb = RS.getClient && RS.getClient();
    if (!sb) return Promise.resolve();
    if (role === 'teacher') {
      return RS.flushKey('pwa_push_teacher', {
        subscription: subJson,
        updatedAt: new Date().toISOString(),
      });
    }
    if (role === 'student' && studentWaqf) {
      var safe = String(studentWaqf).replace(/[^a-zA-Z0-9_]/g, '_');
      return RS.flushKey('pwa_push_student_' + safe, {
        subscription: subJson,
        waqfId: studentWaqf,
        updatedAt: new Date().toISOString(),
      });
    }
    return Promise.resolve();
  }

  async function enableAfterAuth(role, opts) {
    opts = opts || {};
    if (!('Notification' in w)) return;
    await register();
    var reg = await navigator.serviceWorker.ready;
    var perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return;

    var vapid = w.__PWA_VAPID_PUBLIC_KEY__;
    if (!vapid || typeof vapid !== 'string' || !vapid.trim()) return;

    try {
      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapid.trim()),
      });
      await saveSubscriptionToRemote(role, opts.waqfId, sub.toJSON());
    } catch (err) {
      console.warn('MadrasaPwa push subscribe:', err);
    }
  }

  function onRemoteSync() {
    if (!('Notification' in w) || Notification.permission !== 'granted') return;
    if (w.document.visibilityState === 'visible') return;
    var now = Date.now();
    if (now - lastForegroundNotify < MIN_GAP_MS) return;
    lastForegroundNotify = now;
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(function (reg) {
          return reg.showNotification('নতুন আপডেট', {
            body: 'রিমোট ডেটা আপডেট হয়েছে। অ্যাপ খুলুন।',
            icon: new URL('icons/icon-192.png', w.location.href).href,
            badge: new URL('icons/icon-192.png', w.location.href).href,
            tag: 'madrasa-sync',
            renotify: true,
            silent: false,
            vibrate: [200, 100, 200],
          });
        }).then(function () {
          if ('setAppBadge' in navigator) navigator.setAppBadge(1);
        }).catch(function () {});
      } else {
        new Notification('নতুন আপডেট', {
          body: 'রিমোট ডেটা আপডেট হয়েছে। অ্যাপ খুলুন।',
          icon: new URL('icons/icon-192.png', w.location.href).href,
          tag: 'madrasa-sync',
          silent: false,
        });
        if ('setAppBadge' in navigator) navigator.setAppBadge(1);
      }
    } catch (e) {}
  }

  if (w.addEventListener) w.addEventListener('madrasa-remote-sync', onRemoteSync);

  w.MadrasaPwa = { register: register, enableAfterAuth: enableAfterAuth };
})(typeof window !== 'undefined' ? window : globalThis);
