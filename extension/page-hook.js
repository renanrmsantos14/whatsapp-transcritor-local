(() => {
  "use strict";
  const MAX_BYTES = 25 * 1024 * 1024;
  const retained = new Map();
  const seen = new Set();
  const mediaSources = new Map();
  let capture = null;
  let suppressUntil = 0;
  let sequence = 0;
  let mediaSequence = 0;

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
  function mediaId(node) {
    if (!node.dataset.wtMediaId) node.dataset.wtMediaId = `wt-media-${++mediaSequence}`;
    return node.dataset.wtMediaId;
  }

  async function grab(url, sourceId = null) {
    if (!capture || capture.done || (capture.mediaId && capture.mediaId !== sourceId) || typeof url !== "string" || !url.startsWith("blob:")) return;
    capture.done = true;
    const id = capture.id;
    try {
      const response = await fetch(url);
      if (!response.ok) return respond(id, { ok: false, error: `blob fetch ${response.status}` });
      const blob = await response.blob();
      if (!blob.size || blob.size > MAX_BYTES) return respond(id, { ok: false, error: "invalid blob" });
      respond(id, { ok: true, blob, type: blob.type, size: blob.size });
    } catch (error) {
      respond(id, { ok: false, error: String(error?.message || error) });
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
    const sourceId = mediaId(this);
    const source = this.src || this.currentSrc;
    if (source) mediaSources.set(sourceId, source);
    if (!capture) window.postMessage({ __wt: "playing", mediaId: sourceId }, "*");
    grab(source, sourceId);
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
    set(value) { remember(this); const sourceId = mediaId(this); mediaSources.set(sourceId, value); grab(value, sourceId); return sourceDescriptor.set.call(this, value); },
  });

  const OriginalAudio = window.Audio;
  window.Audio = function (src) {
    const audio = new OriginalAudio(src);
    remember(audio);
    const sourceId = mediaId(audio);
    if (src) mediaSources.set(sourceId, src);
    if (src) grab(src, sourceId);
    return audio;
  };
  window.Audio.prototype = OriginalAudio.prototype;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.__wt !== "request") return;
    const { id, action, ms } = event.data;
    if (action === "ping") return respond(id, { ok: true, version: 1 });
    if (action === "arm") {
      suppressUntil = Date.now() + (ms || 30000);
      capture = { id, done: false, mediaId: null };
      return;
    }
    if (action === "capture_playing") {
      const sourceId = typeof event.data.mediaId === "string" ? event.data.mediaId : null;
      capture = { id, done: false, mediaId: sourceId };
      return grab(mediaSources.get(sourceId), sourceId);
    }
    if (action === "hold") { suppressUntil = Date.now() + (ms || 2500); return respond(id, { ok: true }); }
    if (action === "silence") { silence(); return respond(id, { ok: true }); }
    if (action === "disarm") { capture = null; suppressUntil = 0; return respond(id, { ok: true }); }
    respond(id, { ok: false, error: "unknown action" });
  });

  globalThis.__WT_HOOK_VERSION = ++sequence;
})();
