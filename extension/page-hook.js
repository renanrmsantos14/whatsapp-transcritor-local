(() => {
  "use strict";
  const MAX_BYTES = 25 * 1024 * 1024;
  const retained = new Map();
  const sourceOwners = new Map();
  const seen = new Set();
  const mediaStates = new WeakMap();
  let capture = null;
  let suppressUntil = 0;
  let muteEnabled = true;
  let sequence = 0;
  let traceSequence = 0;
  const diagnostics = [];
  const log = (event, details = {}) => {
    diagnostics.push({ time: new Date().toISOString(), event, ...details }); if (diagnostics.length > 100) diagnostics.shift();
    if (globalThis.__WT_TRANSCRITOR_DEBUG__ === true) console.info("[WT hook]", event, details);
  };
  const report = () => {
    console.group("[WT Transcritor] Relatório da captura");
    console.info({ hookVersion: globalThis.__WT_HOOK_VERSION || 1, captureActive: Boolean(capture), muted: suppressing(), retainedAudioCount: retained.size, trackedPlayers: seen.size });
    console.table(diagnostics); console.groupEnd();
  };

  const respond = (id, payload) => window.postMessage({ __wt: "response", id, ...payload }, "*");
  const suppressing = () => Boolean(capture && muteEnabled && Date.now() < suppressUntil);
  const looksLikeAudio = (blob) => {
    const type = (blob?.type || "").toLowerCase();
    return type.startsWith("audio/") || type === "" || (type === "application/octet-stream" && blob.size <= MAX_BYTES);
  };
  const remember = (node) => {
    seen.add(node);
    while (seen.size > 30) seen.delete(seen.values().next().value);
  };
  function observeSourceOwner(node, source) {
    if (typeof source !== "string" || !source.startsWith("blob:") || !retained.has(source)) return;
    let observation = sourceOwners.get(source);
    if (!observation) { observation = { owners: new Set() }; sourceOwners.set(source, observation); }
    try {
      const owner = node?.closest?.("[data-id]"), rects = owner?.getClientRects?.();
      const visible = Boolean(!rects || rects.length);
      const messageId = owner?.isConnected && visible ? owner.getAttribute?.("data-id") : null;
      if (typeof messageId === "string" && messageId) observation.owners.add(messageId);
    } catch (_) {}
  }
  function logPrearmRetained() {
    let sourceObservedCount = 0, exactOwnerCandidateCount = 0, ambiguousOwnerCandidateCount = 0;
    for (const source of retained.keys()) {
      const observation = sourceOwners.get(source);
      if (!observation) continue;
      sourceObservedCount += 1;
      if (observation.owners.size > 1) { ambiguousOwnerCandidateCount += 1; continue; }
      if (observation.owners.size === 1 && observation.owners.has(capture?.messageId)) exactOwnerCandidateCount += 1;
    }
    log("prearm_retained", { traceId: capture?.traceId || null, retainedAudioCount: retained.size, sourceObservedCount, exactOwnerCandidateCount, ambiguousOwnerCandidateCount });
  }
  function consumeRetainedCandidate() {
    if (!capture || capture.done || !retained.size) return false;
    const exact = [...retained.entries()].filter(([source]) => {
      const owners = sourceOwners.get(source)?.owners;
      return owners?.size === 1 && owners.has(capture.messageId);
    });
    const entry = exact.length === 1 ? exact[0] : retained.size === 1 ? retained.entries().next().value : null;
    if (!entry) return false;
    const [url, blob] = entry;
    retained.delete(url);
    sourceOwners.delete(url);
    if (!blob?.size || blob.size > MAX_BYTES) {
      log("prearm_consumed", { traceId: capture.traceId, accepted: false });
      return false;
    }
    capture.done = true;
    log("prearm_consumed", { traceId: capture.traceId, accepted: true });
    finishCapture({ ok: true, blob, type: blob.type, size: blob.size });
    return true;
  }
  const restoreNode = (node) => {
    const state = mediaStates.get(node); if (!state) return;
    try { node.muted = state.muted; node.volume = state.volume; } catch (_) {}
    mediaStates.delete(node);
  };
  const silenceNode = (node) => {
    try {
      if (!mediaStates.has(node)) { mediaStates.set(node, { muted: node.muted, volume: node.volume }); node.addEventListener?.("ended", () => restoreNode(node), { once: true }); }
      node.muted = true; node.volume = 0;
    } catch (_) {}
  };
  const silence = () => {
    for (const node of seen) {
      silenceNode(node);
    }
  };
  const restoreSound = () => {
    for (const node of seen) restoreNode(node);
  };
  const setMute = (enabled) => {
    muteEnabled = enabled === true;
    if (muteEnabled && capture) { suppressUntil = Date.now() + 30000; silence(); }
    else { suppressUntil = 0; restoreSound(); }
  };
  function markedRow() {
    if (!capture?.marker) return null;
    const escaped = globalThis.CSS?.escape ? CSS.escape(capture.marker) : capture.marker.replace(/[^a-zA-Z0-9_-]/g, "");
    return document.querySelector(`[data-wt-capture="${escaped}"]`);
  }
  function markedTarget() {
    if (!capture?.marker) return null;
    const escaped = globalThis.CSS?.escape ? CSS.escape(capture.marker) : capture.marker.replace(/[^a-zA-Z0-9_-]/g, "");
    return document.querySelector(`[data-wt-capture-target="${escaped}"]`);
  }
  function captureOwnsTarget() {
    const row = markedRow(), target = markedTarget(), rects = target?.getClientRects?.();
    const rowConnected = Boolean(row?.isConnected), targetConnected = Boolean(target?.isConnected);
    const targetInsideRow = rowConnected && targetConnected ? Boolean(row.contains?.(target)) : false;
    const targetVisible = targetInsideRow ? Boolean(!rects || rects.length) : false;
    const messageIdMatches = targetVisible && target.getAttribute?.("data-id") === capture?.messageId;
    const owns = Boolean(rowConnected && targetConnected && targetInsideRow && targetVisible && messageIdMatches);
    const details = { traceId: capture?.traceId || null, rowFound: Boolean(row), rowConnected, targetFound: Boolean(target), targetConnected, targetInsideRow, targetVisible, messageIdMatches, owns };
    const snapshot = JSON.stringify(details);
    if (capture && capture.ownershipSnapshot !== snapshot) { capture.ownershipSnapshot = snapshot; log("target_lookup", { traceId: details.traceId, rowFound: details.rowFound, targetFound: details.targetFound }); log("ownership_check", details); }
    return owns;
  }
  async function grab(url) {
    if (!capture) return;
    if (capture.done) { log("capture_candidate", { traceId: capture.traceId, accepted: false, reason: "done" }); return; }
    const owns = captureOwnsTarget(), blobUrl = typeof url === "string" && url.startsWith("blob:");
    log("capture_candidate", { traceId: capture.traceId, blobUrl, owns, accepted: Boolean(blobUrl && owns) });
    if (!owns || !blobUrl) return;
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
    log("capture_finished", { traceId: capture.traceId, ok: result?.ok === true, waiterAttached: Boolean(capture.waiterId) });
    if (capture.waiterId) respond(capture.waiterId, result);
  }

  function scanCapture() {
    if (!capture?.marker || capture.done) return;
    const row = markedRow();
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
      const audioCandidate = value instanceof Blob && looksLikeAudio(value);
      if (capture) log("create_object_url", { traceId: capture.traceId, audioCandidate, blobUrl: typeof url === "string" && url.startsWith("blob:") });
      if (audioCandidate) {
        retained.set(url, value);
        while (retained.size > 40) { const oldest = retained.keys().next().value; retained.delete(oldest); sourceOwners.delete(oldest); }
        grab(url);
      }
    } catch (_) {}
    return url;
  };

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    remember(this);
    const source = this.src || this.currentSrc;
    observeSourceOwner(this, source);
    grab(source);
    if (suppressing()) {
      silenceNode(this);
      return Promise.resolve();
    }
    restoreNode(this);
    return originalPlay.apply(this, arguments);
  };

  const originalBufferStart = globalThis.AudioBufferSourceNode?.prototype?.start;
  if (originalBufferStart) globalThis.AudioBufferSourceNode.prototype.start = function () {
    if (suppressing()) log("web_audio_observed", { traceId: capture?.traceId || null });
    return originalBufferStart.apply(this, arguments);
  };

  const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  if (sourceDescriptor?.set) Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    enumerable: sourceDescriptor.enumerable,
    get() { return sourceDescriptor.get.call(this); },
    set(value) { remember(this); observeSourceOwner(this, value); grab(value); return sourceDescriptor.set.call(this, value); },
  });

  const OriginalAudio = window.Audio;
  window.Audio = function (src) {
    const audio = new OriginalAudio(src);
    remember(audio);
    observeSourceOwner(audio, src);
    return audio;
  };
  window.Audio.prototype = OriginalAudio.prototype;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.__wt === "diagnostic_command") {
      if (event.data.action === "set_debug") globalThis.__WT_TRANSCRITOR_DEBUG__ = event.data.enabled === true;
      if (event.data.action === "set_mute") setMute(event.data.enabled === true);
      return;
    }
    if (event.data.__wt !== "request") return;
    const { id, action, ms, marker, messageId, traceId, muteAudio, forcePlayback } = event.data;
    if (action === "ping") return respond(id, { ok: true, version: 1 });
    if (action === "arm") {
      if (typeof messageId !== "string" || !messageId) return respond(id, { ok: false, error: "missing message id" });
      setMute(muteAudio !== false); suppressUntil = muteAudio === false ? 0 : Date.now() + (ms || 30000);
      const safeTraceId = Number.isSafeInteger(traceId) && traceId > 0 ? traceId : ++traceSequence;
      capture = { done: false, result: null, waiterId: null, marker, messageId, scanTimer: null, traceId: safeTraceId, ownershipSnapshot: "", forcePlayback: forcePlayback === true };
      log("arm", { traceId: safeTraceId, markerPresent: typeof marker === "string" && marker.length > 0, messageIdPresent: true, captureWindowMs: Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60000) : 30000 });
      logPrearmRetained();
      if (muteAudio !== false) silence(); else restoreSound();
      if (capture.forcePlayback || !consumeRetainedCandidate()) {
        scanCapture();
        if (!capture.done) capture.scanTimer = setInterval(scanCapture, 250);
      }
      return respond(id, { ok: true, armed: true });
    }
    if (action === "capture") {
      if (!capture) { log("capture_waiter", { traceId: null, armed: false }); return respond(id, { ok: false, error: "not armed" }); }
      if (capture.result) { log("capture_waiter", { traceId: capture.traceId, armed: true, immediate: true }); return respond(id, capture.result); }
      capture.waiterId = id;
      log("capture_waiter", { traceId: capture.traceId, armed: true, immediate: false });
      return;
    }
    if (action === "hold") { suppressUntil = Date.now() + (ms || 2500); return respond(id, { ok: true }); }
    if (action === "silence") { silence(); return respond(id, { ok: true }); }
    if (action === "set_mute") { setMute(muteAudio === true); return respond(id, { ok: true }); }
    if (action === "disarm") { if (capture?.scanTimer) clearInterval(capture.scanTimer); if (capture) log("disarm", { traceId: capture.traceId, done: capture.done }); capture = null; suppressUntil = 0; restoreSound(); return respond(id, { ok: true }); }
    respond(id, { ok: false, error: "unknown action" });
  });

  globalThis.WTTranscritor = Object.freeze({
    debug(enabled = true) { globalThis.__WT_TRANSCRITOR_DEBUG__ = enabled === true; window.postMessage({ __wt: "diagnostic_command", action: "set_debug", enabled: enabled === true }, "*"); console.info(`[WT Transcritor] Debug ${enabled === true ? "ativado" : "desativado"}.`); },
    report() { report(); window.postMessage({ __wt: "diagnostic_command", action: "report" }, "*"); },
  });
  globalThis.__WT_TRANSCRITOR_REPORT__ = () => globalThis.WTTranscritor.report();
  log("hook_loaded");

  globalThis.__WT_HOOK_VERSION = ++sequence;
})();
