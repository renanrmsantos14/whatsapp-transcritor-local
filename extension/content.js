(() => {
  "use strict";
  const S = WTSelectors, controls = new WeakMap(), active = new Set(), jobs = new Map(), views = new Map(), autoAttempted = new Set(); let diagnosticSequence = 0, autoTranscribe = false, muteAudio = true, captureChain = Promise.resolve();
  const diagnosticAction = (action) => ["ping", "arm", "capture", "disarm", "hold", "silence", "set_mute"].includes(action) ? action : "other";
  const traceFrom = (extra) => Number.isSafeInteger(extra?.traceId) && extra.traceId > 0 ? extra.traceId : null;
  const diagnostics = [];
  const log = (event, details = {}) => {
    diagnostics.push({ time: new Date().toISOString(), event, ...details }); if (diagnostics.length > 100) diagnostics.shift();
    if (globalThis.__WT_TRANSCRITOR_DEBUG__ === true) console.info("[WT content]", event, details);
  };
  const report = () => {
    console.group("[WT Transcritor] Relatório do conteúdo");
    console.info({ autoTranscribe, muteAudio, activeJobs: active.size, visibleControls: views.size });
    console.table(diagnostics); console.groupEnd();
  };
  const STYLE = `:host{display:block;width:100%;box-sizing:border-box}.wt-wrap{box-sizing:border-box;width:min(390px,calc(100% - 16px));margin:6px 0 8px;padding:10px 14px 12px;border:1px solid rgba(0,0,0,.08);border-radius:10px;background:rgba(255,255,255,.82);color:inherit;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.04);user-select:text}.wt-bar{display:flex;align-items:center;gap:6px;min-height:26px}.wt-status{color:rgba(0,0,0,.62);font-size:11px;font-weight:650;letter-spacing:.01em;white-space:nowrap}.wt-result{margin-top:7px;max-height:190px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;scrollbar-width:thin;cursor:text}.wt-action,.wt-copy,.wt-retry,.wt-cancel{min-height:30px;border:0;border-radius:7px;background:transparent;color:#087f5b;cursor:pointer;font:600 11px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;padding:6px 8px}.wt-action{margin-left:auto;background:rgba(8,127,91,.1)}.wt-copy,.wt-cancel{margin-left:auto}.wt-retry{margin-left:4px}.wt-action:hover,.wt-copy:hover,.wt-retry:hover,.wt-cancel:hover{background:rgba(8,127,91,.16)}button[hidden]{display:none}.wt-wrap[data-state=busy]{background:rgba(0,0,0,.035)}.wt-wrap[data-state=error]{background:rgba(180,45,35,.08);border-color:rgba(180,45,35,.2);color:#8b1e1e}.wt-wrap[data-state=success]{background:rgba(8,127,91,.055);border-color:rgba(8,127,91,.18)}.wt-wrap[data-direction=outgoing]{margin-left:auto}.wt-wrap[data-direction=incoming]{margin-left:0}@media(prefers-color-scheme:dark){.wt-wrap{border-color:rgba(255,255,255,.13);background:rgba(35,35,34,.86)}.wt-status{color:rgba(255,255,255,.68)}.wt-action,.wt-copy,.wt-retry,.wt-cancel{color:#76d2ae}.wt-wrap[data-state=success]{background:rgba(90,220,150,.1)}}`;
  const SOUND_STYLE = `.wt-sound{min-width:30px;min-height:30px;border:0;border-radius:7px;padding:4px;background:transparent;color:#087f5b;cursor:pointer;font-size:16px;line-height:1}.wt-sound:hover{background:rgba(8,127,91,.16)}.wt-sound:focus-visible{outline:2px solid #70bd9e;outline-offset:1px}@media(prefers-color-scheme:dark){.wt-sound{color:#76d2ae}}`;
  const SHARED_SHEET = (() => { try { if (typeof CSSStyleSheet !== "function") return null; const sheet = new CSSStyleSheet(); sheet.replaceSync(STYLE + SOUND_STYLE); return sheet; } catch (_) { return null; } })();
  const runtime = (message) => new Promise((resolve) => {
    const api = globalThis.chrome?.runtime;
    if (!api?.sendMessage) return resolve({ ok: false, error: { code: "extension_reloaded", message: "Extensão atualizada. Recarregue a aba do WhatsApp.", retryable: false } });
    try { api.sendMessage(message, (response) => resolve(api.lastError ? { ok: false, error: { code: "backend_unavailable", message: api.lastError.message, retryable: true } } : response)); }
    catch (error) { resolve({ ok: false, error: { code: "extension_reloaded", message: error?.message || "Extensão atualizada. Recarregue a aba do WhatsApp.", retryable: false } }); }
  });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const askPage = (action, extra = {}, timeout = 35000) => new Promise((resolve) => {
    const traceId = traceFrom(extra), safeAction = diagnosticAction(action), safeTimeout = Number.isFinite(timeout) ? Math.max(0, Math.min(timeout, 60000)) : 0;
    log("page_request", { traceId, action: safeAction, timeoutMs: safeTimeout });
    const id = crypto.randomUUID(), listener = (event) => { if (event.source === window && event.data?.__wt === "response" && event.data.id === id) { clearTimeout(timer); removeEventListener("message", listener); log("page_response", { traceId, action: safeAction, ok: event.data.ok === true, hasBlob: Boolean(event.data.blob), failed: event.data.ok === false }); resolve(event.data); } };
    addEventListener("message", listener); postMessage({ __wt: "request", id, action, ...extra }, "*");
    const timer = setTimeout(() => { removeEventListener("message", listener); log("page_timeout", { traceId, action: safeAction, timeoutMs: safeTimeout }); resolve({ ok: false, error: "timeout" }); }, timeout);
  });
  const hashBlob = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function base64(blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); let value = ""; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value); }
  function render(ui, state, text = "") {
    ui.host.dataset.state = state; ui.host.dataset.hasResult = state === "Transcrição" ? "true" : "false";
    ui.status.textContent = state; ui.result.textContent = text; ui.wrap.dataset.state = state === "Transcrição" ? "success" : state === "Erro" ? "error" : /Capturando|fila|Transcrevendo/.test(state) ? "busy" : "idle";
    ui.result.hidden = !text;
    const busy = ["Capturando", "Na fila", "Transcrevendo"].some((value) => state.startsWith(value));
    ui.retry.hidden = state !== "Transcrição"; ui.retry.disabled = busy;
    if (busy) { ui.action.dataset.action = "cancel"; ui.action.textContent = "Cancelar"; }
    else if (state === "Transcrição") { ui.action.dataset.action = "copy"; ui.action.textContent = "Copiar"; }
    else if (state === "Erro") { ui.action.dataset.action = "retry"; ui.action.textContent = "Tentar novamente"; }
    else { ui.action.dataset.action = "run"; ui.action.textContent = "Transcrever"; }
  }
  function renderMessage(messageId, state, text = "") {
    const job = jobs.get(messageId); if (job) { job.state = state; job.text = text; }
    const view = views.get(messageId); if (view?.row.isConnected && S.messageId(view.row) === messageId) render(view.ui, state, text);
  }
  function syncPlacement(row, ui) {
    const outgoing = S.isOutgoing(row), anchor = S.bubbleAnchor(row);
    const rowBox = row?.getBoundingClientRect?.(), bubbleBox = anchor?.getBoundingClientRect?.();
    ui.wrap.dataset.direction = outgoing ? "outgoing" : "incoming";
    if (!rowBox || !bubbleBox || rowBox.width <= 0 || bubbleBox.width < 120) return;
    const width = Math.round(Math.min(390, bubbleBox.width));
    const inset = Math.max(0, Math.round(outgoing ? rowBox.right - bubbleBox.right : bubbleBox.left - rowBox.left));
    ui.wrap.style.width = `${width}px`;
    ui.wrap.style.marginLeft = outgoing ? "auto" : `${inset}px`;
    ui.wrap.style.marginRight = outgoing ? `${inset}px` : "auto";
  }
  function revealIfLast(row, ui) {
    if (!S.isLastMessage(row)) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!row.isConnected || !S.isLastMessage(row)) return;
      ui.host.scrollIntoView({ block: "end", inline: "nearest" });
      let container = row.parentElement;
      while (container) {
        if (container.scrollHeight > container.clientHeight + 1) { container.scrollTop = container.scrollHeight; break; }
        container = container.parentElement;
      }
    }));
  }
  function createUI(row) {
    const host = document.createElement("div"); host.dataset.wtControl = "true";
    const root = host.attachShadow({ mode: "closed" }), sharedStyles = Boolean(SHARED_SHEET && "adoptedStyleSheets" in root);
    if (sharedStyles) root.adoptedStyleSheets = [SHARED_SHEET];
    root.innerHTML = `${sharedStyles ? "" : `<style>${STYLE + SOUND_STYLE}</style>`}<div class="wt-wrap"><div class="wt-bar"><span class="wt-status" role="status" aria-live="polite"></span><button class="wt-action" type="button"></button><button class="wt-retry" type="button" hidden>Refazer</button><button class="wt-sound" type="button"></button></div><div class="wt-result"></div></div>`;
    const ui = { host, wrap: root.querySelector(".wt-wrap"), status: root.querySelector(".wt-status"), result: root.querySelector(".wt-result"), action: root.querySelector(".wt-action"), retry: root.querySelector(".wt-retry"), sound: root.querySelector(".wt-sound"), messageId: null, jobId: null, canceled: false, restoring: false };
    for (const type of ["click", "pointerdown", "mousedown", "mouseup"]) host.addEventListener(type, (event) => event.stopPropagation());
    const messageId = S.messageId(row); ui.messageId = messageId;
    ui.action.onclick = () => handleAction(row, ui);
    ui.retry.onclick = () => { if (ui.retry.disabled) return; ui.retry.disabled = true; return queueRun(row, ui, false, true); };
    ui.sound.onclick = async () => { muteAudio = !muteAudio; syncSoundButtons(); await askPage("set_mute", { muteAudio }, 1000); await runtime({ type: "SETTINGS_UPDATE", settings: { muteAudio } }); };
    row.append(host); controls.set(row, ui); views.set(messageId, { row, ui }); syncPlacement(row, ui); revealIfLast(row, ui);
    const job = jobs.get(messageId);
    renderSound(ui); if (job) { ui.jobId = job.jobId; render(ui, job.state, job.text); } else { render(ui, "Pronto"); ui.restoring = true; restore(row, ui).then((restored) => { ui.restoring = false; if (!restored) maybeAutoRun(row, ui); }); }
    return ui;
  }
  function renderSound(ui) {
    ui.sound.textContent = muteAudio ? "🔇" : "🔊";
    ui.sound.title = muteAudio ? "Ativar som na captura" : "Mutar som na captura";
    ui.sound.setAttribute("aria-label", ui.sound.title); ui.sound.setAttribute("aria-pressed", String(muteAudio));
  }
  function syncSoundButtons() { for (const view of views.values()) renderSound(view.ui); }
  async function handleAction(row, ui) {
    if (ui.action.dataset.action === "cancel") return cancel(ui.messageId);
    if (ui.action.dataset.action === "copy") { await navigator.clipboard.writeText(ui.result.textContent || ""); ui.action.textContent = "Copiado"; setTimeout(() => { if (ui.action.dataset.action === "copy") ui.action.textContent = "Copiar"; }, 1000); return; }
    return queueRun(row, ui);
  }
  async function restore(row, ui) { const messageId = ui.messageId, response = await runtime({ type: "CACHE_GET", messageId }); if (response?.cached && row.isConnected && controls.get(row) === ui && S.messageId(row) === messageId) { render(ui, "Transcrição", response.cached.text); revealIfLast(row, ui); return true; } return false; }
  async function playbackButton(row, initial, timeout = 5000) {
    if (!S.isDownloadButton(initial)) return initial;
    if (globalThis.PointerEvent) initial.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true })); initial.click();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const button = S.transportButton(row); if (button && !S.isDownloadButton(button)) return button; await sleep(100); }
    throw problem("capture_failed", "O áudio não ficou pronto para reprodução.", true);
  }
  async function capture(row, ui) {
    const traceId = ++diagnosticSequence;
    render(ui, "Capturando", muteAudio ? "Capturando sem reproduzir…" : "Reproduzindo áudio para capturar…"); log("capture_start", { traceId }); if (!(await askPage("ping", { traceId }, 2000)).ok) { log("capture_abort", { traceId, boundary: "ping" }); throw problem("capture_failed", "Recarregue a aba do WhatsApp.", true); }
    const initialButton = S.transportButton(row); log("transport_lookup", { traceId, found: Boolean(initialButton) }); if (!initialButton) { log("capture_abort", { traceId, boundary: "transport" }); throw problem("capture_failed", "Controle de áudio não encontrado.", true); }
    const playButton = await playbackButton(row, initialButton);
    const messageId = S.messageId(row), target = S.messageNode(row); log("target_lookup", { traceId, messageIdPresent: Boolean(messageId), targetFound: Boolean(target) }); if (!messageId || !target) { log("capture_abort", { traceId, boundary: "message_target" }); throw problem("capture_failed", "Mensagem de áudio não identificada.", true); }
    const marker = crypto.randomUUID(); row.dataset.wtCapture = marker; target.dataset.wtCaptureTarget = marker;
    const captureMuted = muteAudio;
    const armed = await askPage("arm", { ms: 30000, marker, messageId, traceId, muteAudio: captureMuted, forcePlayback: true }, 2000); if (!armed.ok) { log("capture_abort", { traceId, boundary: "arm" }); throw problem("capture_failed", "Captura local não foi armada.", true); }
    try {
      if (captureMuted) await askPage("hold", { ms: 30000, traceId }, 1000);
      const pending = askPage("capture", { traceId }, 35000);
      if (globalThis.PointerEvent) playButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      playButton.click();
      if (captureMuted) await askPage("silence", { traceId }, 1000);
      const response = await pending;
      log("capture_result", { traceId, ok: response.ok === true, hasBlob: Boolean(response.blob) }); if (!response.ok || !response.blob) throw problem("capture_failed", "Áudio não capturado.", true); return response.blob;
    }
    finally { if (row.dataset.wtCapture === marker) delete row.dataset.wtCapture; if (target.dataset.wtCaptureTarget === marker) delete target.dataset.wtCaptureTarget; await askPage("disarm", { traceId }, 2500); }
  }
  function problem(code, message, retryable) { return { code, message, retryable }; }
  async function cancel(messageId) { const job = jobs.get(messageId); if (!job) return; job.canceled = true; if (job.jobId) await runtime({ type: "CANCEL_JOB", jobId: job.jobId }); renderMessage(messageId, "Cancelado", "Transcrição cancelada."); }
  function queueCapture(row, ui, tracked) {
    const task = captureChain.then(() => tracked.canceled ? null : capture(row, ui));
    captureChain = task.catch(() => {}); return task;
  }
  function queueRun(row, ui, automatic = false, ignoreCache = false) {
    if (automatic && (!autoTranscribe || !row.isConnected || controls.get(row) !== ui || S.messageId(row) !== ui.messageId)) { autoAttempted.delete(ui.messageId); return Promise.resolve(); }
    return run(row, ui, 0, ignoreCache);
  }
  function maybeAutoRun(row, ui) {
    const messageId = S.messageId(row);
    if (!autoTranscribe || S.isOutgoing(row) || S.isUnplayedVoice(row) !== true || !messageId || autoAttempted.has(messageId) || ui.restoring || ui.host.dataset.state !== "Pronto") return;
    autoAttempted.add(messageId); queueRun(row, ui, true);
  }
  async function run(row, ui, attempt = 0, ignoreCache = false) {
    const expectedId = S.messageId(row); if (active.has(expectedId)) return;
    active.add(expectedId); const tracked = { state: "Capturando", text: muteAudio ? "Capturando sem reproduzir…" : "Reproduzindo áudio para capturar…", jobId: null, canceled: false }; jobs.set(expectedId, tracked);
    try {
      const blob = await queueCapture(row, ui, tracked); if (tracked.canceled || !blob) return; const audioHash = await hashBlob(blob);
      if (!ignoreCache) { const cached = await runtime({ type: "CACHE_GET", messageId: expectedId, audioHash }); if (cached?.cached) { renderMessage(expectedId, "Transcrição", cached.cached.text); return; } }
      while (true) {
        renderMessage(expectedId, "Na fila", "Aguardando o worker local…"); const created = await runtime({ type: "CREATE_JOB", audioBase64: await base64(blob), mime: blob.type });
        if (!created?.ok) throw created.error; tracked.jobId = created.job.job_id; const currentView = views.get(expectedId); if (currentView) currentView.ui.jobId = tracked.jobId;
        const started = Date.now();
        while (!tracked.canceled) {
          const response = await runtime({ type: "GET_JOB", jobId: tracked.jobId, messageId: expectedId, audioHash }); if (!response?.ok) throw response.error; const job = response.job;
          if (job.state === "completed") { renderMessage(expectedId, "Transcrição", job.result.text); return; }
          if (job.state === "failed") throw job.error;
          if (job.state === "canceled") { renderMessage(expectedId, "Cancelado", "Transcrição cancelada."); return; }
          renderMessage(expectedId, `Transcrevendo · ${Math.floor((Date.now() - started) / 1000)}s`, job.stage === "preparing" ? "Preparando modelo…" : "Processando localmente…");
          await sleep(Date.now() - started < 10000 ? 1000 : 2000);
        }
        return;
      }
    } catch (error) {
      if (error?.retryable && attempt < 1 && !tracked.canceled) { active.delete(expectedId); return run(row, ui, attempt + 1, ignoreCache); }
      if (!tracked.canceled) renderMessage(expectedId, "Erro", error?.message || "Não foi possível transcrever.");
    } finally { active.delete(expectedId); }
  }
  function processRow(row, syncExisting = false) {
    const ui = controls.get(row), messageId = S.messageId(row);
    if (!ui?.host.isConnected || ui.messageId !== messageId) {
      if (ui) { if (views.get(ui.messageId)?.ui === ui) views.delete(ui.messageId); ui.host.remove(); controls.delete(row); }
      createUI(row);
    } else { if (syncExisting) syncPlacement(row, ui); maybeAutoRun(row, ui); }
  }
  function scan(root = document, syncExisting = false, seen = new Set()) {
    for (const row of S.rows(root)) { if (!row.isConnected || seen.has(row)) continue; seen.add(row); processRow(row, syncExisting); }
  }
  function cleanupViews() {
    for (const [messageId, view] of views) if (!view.row.isConnected) { views.delete(messageId); controls.delete(view.row); }
  }
  let scanScheduled = false, fullScanPending = false;
  const pendingRoots = new Set();
  function flushScan() {
    scanScheduled = false; cleanupViews();
    if (fullScanPending) { fullScanPending = false; pendingRoots.clear(); scan(document, true); return; }
    const seen = new Set();
    for (const root of pendingRoots) if (root?.isConnected) scan(root, false, seen);
    pendingRoots.clear();
  }
  function scheduleScan(mutations = []) {
    if (!mutations.length) fullScanPending = true;
    for (const mutation of mutations) {
      const target = mutation.target?.querySelectorAll ? mutation.target : mutation.target?.parentElement;
      if (target) { pendingRoots.add(target); const row = S.rowForNode(target); if (row) pendingRoots.add(row); }
      for (const node of mutation.addedNodes || []) {
        const root = node?.querySelectorAll ? node : node?.parentElement;
        if (root) pendingRoots.add(root);
      }
    }
    if (scanScheduled) return;
    scanScheduled = true; requestAnimationFrame(flushScan);
  }
  async function loadSettings() { const response = await runtime({ type: "SETTINGS_GET" }); autoTranscribe = response?.settings?.autoTranscribe === true; muteAudio = response?.settings?.muteAudio !== false; postMessage({ __wt: "diagnostic_command", action: "set_mute", enabled: muteAudio }, "*"); syncSoundButtons(); scheduleScan(); }
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => { if (area === "local" && changes["wt:v2:settings"]) { const settings = changes["wt:v2:settings"].newValue || {}; autoTranscribe = settings.autoTranscribe === true; muteAudio = settings.muteAudio !== false; syncSoundButtons(); if (autoTranscribe) scheduleScan(); } });
  addEventListener("message", (event) => { if (event.source !== window || event.data?.__wt !== "diagnostic_command") return; if (event.data.action === "set_debug") globalThis.__WT_TRANSCRITOR_DEBUG__ = event.data.enabled === true; if (event.data.action === "report") report(); });
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true }); scan(document, true); loadSettings();
  addEventListener("resize", () => scheduleScan(), { passive: true });
})();
