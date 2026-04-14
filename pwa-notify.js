/* Waqful Madinah — PWA: SW registration, Web Push subscribe */
(function (w) {

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
    if (!RS || !RS.isRemote || !RS.isRemote()) return Promise.resolve();
    var sb = RS.getClient && RS.getClient();
    if (!sb) return Promise.resolve();
    var id = role === 'teacher' ? 'teacher' : (studentWaqf ? String(studentWaqf) : null);
    if (!id) return Promise.resolve();
    // Save directly to pwa_subscriptions table via RPC (no PIN required)
    return sb.rpc('madrasa_rel_save_pwa_subscription', {
      p_id: id,
      p_role: role,
      p_subscription: subJson,
    }).then(function (res) {
      if (res.error) console.warn('MadrasaPwa sub save:', res.error);
    });
  }

  async function saveSharedSubscription(subJson, role, idOverride) {
    var RS = w.RemoteSync;
    if (RS && RS.isRemote && RS.isRemote()) {
      var sb = RS.getClient && RS.getClient();
      if (sb) {
        var res = await sb.rpc('madrasa_rel_save_pwa_subscription', {
          p_id: idOverride,
          p_role: role,
          p_subscription: subJson,
        });
        if (res.error) console.warn('MadrasaPwa shared sub save:', res.error);
        else console.log('MadrasaPwa: shared device subscribed as', idOverride);
        return !res.error;
      }
    }
    return false;
  }

  async function subscribeToPush(role, idOverride) {
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
      var subJson = sub.toJSON();
      if (idOverride) {
        var saved = await saveSharedSubscription(subJson, role, idOverride);
        if (!saved) {
          // RemoteSync not ready yet — retry on first sync event OR after 8s
          var _retried = false;
          async function _retrySave() {
            if (_retried) return;
            _retried = true;
            w.removeEventListener('madrasa-remote-sync', _retrySave);
            await saveSharedSubscription(subJson, role, idOverride);
          }
          w.addEventListener('madrasa-remote-sync', _retrySave);
          setTimeout(async function() {
            if (!_retried) await _retrySave();
          }, 8000);
        }
      } else {
        await saveSubscriptionToRemote(role, null, subJson);
      }
    } catch (err) {
      console.warn('MadrasaPwa push subscribe:', err);
    }
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

  // Call this when student panel is first opened (before login)
  // Subscribes this device as 'shared_student_device' so all student notifications arrive
  async function enableSharedStudentDevice() {
    await subscribeToPush('student', 'shared_student_device');
  }

  w.MadrasaPwa = { register: register, enableAfterAuth: enableAfterAuth, enableSharedStudentDevice: enableSharedStudentDevice };
})(typeof window !== 'undefined' ? window : globalThis);
