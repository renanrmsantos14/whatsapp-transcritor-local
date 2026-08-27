(() => {
  "use strict";
  const MAX_BYTES = 25 * 1024 * 1024;
  const retained = new Map();
  const seen = new Set();
  let capture = null;
  let suppressUntil = 0;
  let sequence = 0;
  const log = (event, details = {}) => console.info("[WT hook]", event, details);

  const respond = (id, payload) => window.postMessage({ __wt: "response", id, ...payload }, "*");
  const suppressing = () => Date.now() < suppressUntil;
  const looksLikeAudio = (blob) => {
    const type = (blob?.type || "").toLowerCase();
    return type.startsWith("audio/") || type === "" || (type === "application/octet-stream" && blob.size <= MAX_BYTES);
  };
  const remember = (node) => {
    seen.add(node);
    while (seen.size > 30) seen.delete(seen.values().next().value);
  };
  const silence = () => {
    for (const node of seen) {
      try { node.pause(); node.currentTime = 0; node.muted = true; node.volume = 0; } catch (_) {}
    }
  };
  async function grab(url) {
    if (!capture || capture.done || typeof url !== "string" || !url.startsWith("blob:")) return;
    capture.done = true;
    try {
      const response = await fetch(url);
      if (!response.ok) return finishCapture({ ok: false, error: `blob fetch ${response.status}` });
      const blob = await response.blob();
      if (!blob.size || blob.size > MAX_BYTES) return finishCapture({ ok: false, error: "invalid blob" });
      finishCapture({ ok: true, blob, type: blob.type, size: blob.size });
    } catch (error) {
      finishCapture({ ok: false, error: String(error?.message || error) });
    }
  }

  function finishCapture(result) {
    if (!capture) return;
    if (capture.scanTimer) clearInterval(capture.scanTimer);
    capture.result = result;
    if (capture.waiterId) respond(capture.waiterId, result);
  }

  function scanCapture() {
    if (!capture?.marker || capture.done) return;
    const escaped = globalThis.CSS?.escape ? CSS.escape(capture.marker) : capture.marker.replace(/[^a-zA-Z0-9_-]/g, "");
    const row = document.querySelector(`[data-wt-capture="${escaped}"]`);
    if (!row) return;
    for (const media of row.querySelectorAll("audio, video, source")) {
      const source = media.currentSrc || media.src || media.getAttribute?.("src") || "";
      if (source.startsWith("blob:")) { grab(source); return; }
    }
  }

  const originalCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (value) {
    const url = originalCreate(value);
    try {
      if (value instanceof Blob && looksLikeAudio(value)) {
        retained.set(url, value);
        while (retained.size > 40) retained.delete(retained.keys().next().value);
        grab(url);
      }
    } catch (_) {}
    return url;
  };

  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play = function () {
    remember(this);
    const source = this.src || this.currentSrc;
    grab(source);
    if (suppressing()) {
      try { this.muted = true; this.volume = 0; originalPause.call(this); } catch (_) {}
      return Promise.resolve();
    }
    return originalPlay.apply(this, arguments);
  };

  const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  if (sourceDescriptor?.set) Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    enumerable: sourceDescriptor.enumerable,
    get() { return sourceDescriptor.get.call(this); },
    set(value) { remember(this); grab(value); return sourceDescriptor.set.call(this, value); },
  });

  const OriginalAudio = window.Audio;
  window.Audio = function (src) {
    const audio = new OriginalAudio(src);
    remember(audio);
    if (src) grab(src);
    return audio;
  };
  window.Audio.prototype = OriginalAudio.prototype;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.__wt !== "request") return;
    const { id, action, ms, marker } = event.data;
    if (action === "ping") return respond(id, { ok: true, version: 1 });
    if (action === "arm") {
      suppressUntil = Date.now() + (ms || 30000);
      capture = { done: false, result: null, waiterId: null, marker, scanTimer: null };
      silence();
      scanCapture();
      capture.scanTimer = setInterval(scanCapture, 100);
      return respond(id, { ok: true, armed: true });
    }
    if (action === "capture") {
      if (!capture) return respond(id, { ok: false, error: "not armed" });
      if (capture.result) return respond(id, capture.result);
      capture.waiterId = id;
      return;
    }
    if (action === "hold") { suppressUntil = Date.now() + (ms || 2500); return respond(id, { ok: true }); }
    if (action === "silence") { silence(); return respond(id, { ok: true }); }
    if (action === "disarm") { if (capture?.scanTimer) clearInterval(capture.scanTimer); capture = null; suppressUntil = 0; return respond(id, { ok: true }); }
    respond(id, { ok: false, error: "unknown action" });
  });

  globalThis.__WT_TRANSCRITOR_REPORT__ = () => window.postMessage({ __wt: "report_request" }, "*");
  log("hook_loaded");

  globalThis.__WT_HOOK_VERSION = ++sequence;
})();
