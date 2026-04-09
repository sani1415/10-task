/* Browser-only: several image Files → one PDF. Load after jsPDF UMD. */
(function (global) {
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('read_error'));
      r.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image_load_error'));
      img.src = dataUrl;
    });
  }

  async function fileToScaledJpegDataUrl(file, maxSide) {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w < 1 || h < 1) throw new Error('image_load_error');
    if (w > maxSide || h > maxSide) {
      const r = Math.min(maxSide / w, maxSide / h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.88);
  }

  async function mergeImageFilesToPdf(imageFiles) {
    const jspdfMod = global.jspdf;
    if (!jspdfMod || !jspdfMod.jsPDF) throw new Error('pdf_lib_missing');
    const { jsPDF } = jspdfMod;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const margin = 24;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const maxW = pageW - 2 * margin;
    const maxH = pageH - 2 * margin;
    const maxRasterSide = 1600;

    for (let i = 0; i < imageFiles.length; i++) {
      if (i > 0) doc.addPage();
      const jpegUrl = await fileToScaledJpegDataUrl(imageFiles[i], maxRasterSide);
      const img = await loadImage(jpegUrl);
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const scale = Math.min(maxW / iw, maxH / ih, 1);
      const dw = iw * scale;
      const dh = ih * scale;
      const x = margin + (maxW - dw) / 2;
      const y = margin + (maxH - dh) / 2;
      doc.addImage(jpegUrl, 'JPEG', x, y, dw, dh);
    }

    const buf = doc.output('arraybuffer');
    const blob = new Blob([buf], { type: 'application/pdf' });
    const raw = (imageFiles[0] && imageFiles[0].name ? imageFiles[0].name : 'images').replace(/\.[^.]+$/i, '');
    const base = raw.replace(/[\\/:"*?<>|]+/g, '_').trim().slice(0, 80) || 'images';
    return new File([blob], base + '_combined.pdf', { type: 'application/pdf' });
  }

  global.mergeImageFilesToPdf = mergeImageFilesToPdf;
})(typeof window !== 'undefined' ? window : globalThis);
