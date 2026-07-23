/* Browser-only: render PDF pages in a modal via pdf.js (avoids mobile iframe “open again”). */
(function (global) {
  var PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  var MAX_PAGES = 40;
  var loadPromise = null;
  var activeToken = 0;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (global.pdfjsLib) {
        resolve();
        return;
      }
      var existing = document.querySelector('script[data-waqf-pdfjs="1"]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('pdfjs_load_fail')); });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.setAttribute('data-waqf-pdfjs', '1');
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('pdfjs_load_fail')); };
      document.head.appendChild(s);
    });
  }

  function ensurePdfJs() {
    if (global.pdfjsLib) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return Promise.resolve(global.pdfjsLib);
    }
    if (!loadPromise) {
      loadPromise = loadScript(PDFJS_SRC).then(function () {
        if (!global.pdfjsLib) throw new Error('pdfjs_missing');
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        return global.pdfjsLib;
      }).catch(function (err) {
        loadPromise = null;
        throw err;
      });
    }
    return loadPromise;
  }

  function isPdfMeta(meta) {
    if (!meta) return false;
    var ft = String(meta.fileType || '').toLowerCase();
    var name = String(meta.fileName || meta.name || '').toLowerCase();
    return ft === 'pdf' || ft === 'application/pdf' || ft.indexOf('pdf') !== -1 || /\.pdf$/i.test(name);
  }

  function setLoading(container, msg) {
    container.innerHTML =
      '<div class="pdf-preview-loading" role="status">' +
      '<span class="pdf-preview-loading-icon" aria-hidden="true">📄</span>' +
      '<span>' + (msg || 'পিডিএফ লোড হচ্ছে…') + '</span></div>';
  }

  function setError(container, url, fileName) {
    var safeName = String(fileName || 'ফাইল').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var openLink = url
      ? '<a class="pdf-preview-open-link" href="' + String(url).replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">নতুন ট্যাবে খুলুন</a>'
      : '';
    container.innerHTML =
      '<div class="pdf-preview-fallback">' +
      '<p>মোডালে প্রিভিউ দেখানো যায়নি।</p>' +
      '<p class="pdf-preview-fallback-name">' + safeName + '</p>' +
      openLink +
      '</div>';
  }

  function fetchPdfBytes(url) {
    return fetch(url, { credentials: 'omit', mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('pdf_fetch_' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function renderPage(page, containerWidth, wrap) {
    var base = page.getViewport({ scale: 1 });
    var cssScale = Math.min(2, Math.max(0.6, (containerWidth - 8) / base.width));
    var dpr = Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 2);
    var viewport = page.getViewport({ scale: cssScale * dpr });
    var canvas = document.createElement('canvas');
    canvas.className = 'pdf-preview-page';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
    canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
    var ctx = canvas.getContext('2d', { alpha: false });
    wrap.appendChild(canvas);
    return page.render({ canvasContext: ctx, viewport: viewport }).promise;
  }

  /**
   * @param {HTMLElement} container
   * @param {string} url - signed / blob / data URL
   * @param {{ maxHeight?: string, fileName?: string, maxPages?: number }} [opts]
   */
  function render(container, url, opts) {
    opts = opts || {};
    if (!container || !url) return Promise.resolve();
    var token = ++activeToken;
    var maxHeight = opts.maxHeight || '65vh';
    var maxPages = opts.maxPages || MAX_PAGES;
    setLoading(container);

    return ensurePdfJs().then(function (pdfjsLib) {
      if (token !== activeToken) return null;
      return fetchPdfBytes(url).then(function (bytes) {
        if (token !== activeToken) return null;
        return pdfjsLib.getDocument({ data: bytes }).promise;
      });
    }).then(function (pdf) {
      if (!pdf || token !== activeToken) return;
      var wrap = document.createElement('div');
      wrap.className = 'pdf-preview-wrap';
      wrap.style.maxHeight = maxHeight;
      var width = Math.max(container.clientWidth || 280, 220);
      var total = pdf.numPages;
      var limit = Math.min(total, maxPages);
      var chain = Promise.resolve();
      for (var i = 1; i <= limit; i++) {
        (function (pageNum) {
          chain = chain.then(function () {
            if (token !== activeToken) return;
            return pdf.getPage(pageNum).then(function (page) {
              if (token !== activeToken) return;
              return renderPage(page, width, wrap);
            });
          });
        })(i);
      }
      return chain.then(function () {
        if (token !== activeToken) return;
        if (total > limit) {
          var more = document.createElement('p');
          more.className = 'pdf-preview-more';
          more.textContent = 'প্রথম ' + limit + ' পৃষ্ঠা দেখানো হচ্ছে · ডাউনলোড করলে পুরো ফাইল পাবেন';
          wrap.appendChild(more);
        }
        container.innerHTML = '';
        container.appendChild(wrap);
      });
    }).catch(function (err) {
      console.error('[PdfPreview]', err);
      if (token !== activeToken) return;
      setError(container, url, opts.fileName);
    });
  }

  function cancel() {
    activeToken += 1;
  }

  global.PdfPreview = {
    isPdfMeta: isPdfMeta,
    render: render,
    cancel: cancel,
  };
})(typeof window !== 'undefined' ? window : this);
