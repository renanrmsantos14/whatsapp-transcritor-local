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
  const UX_STYLE = `
    .wt-wrap{padding:10px 12px;border-radius:11px;background:#fff;color:#182a22;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 1px 5px rgba(15,45,30,.07)}
    .wt-bar{flex-wrap:wrap;gap:5px;min-height:44px}
    .wt-status{font-size:12px;font-weight:700;color:#426050}
    .wt-action,.wt-retry,.wt-sound{min-height:44px;border-radius:8px;font:650 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;transition:background-color 140ms ease,color 140ms ease}
    .wt-action{padding:8px 12px;background:#e4f4eb;color:#086a49}
    .wt-retry{margin-left:0;padding:8px 9px;color:#086a49}
    .wt-sound{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;padding:0;color:#527467}
    .wt-sound svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .wt-action:hover,.wt-retry:hover,.wt-sound:hover{background:#d2eddf}
    .wt-action:focus-visible,.wt-retry:focus-visible,.wt-sound:focus-visible,.wt-result:focus-visible{outline:2px solid #0a8559;outline-offset:2px}
    .wt-action:active,.wt-retry:active,.wt-sound:active{background:#bce3d0}
    .wt-wrap[data-state=idle]{width:max-content!important;max-width:calc(100% - 16px);padding:3px;border-color:transparent;background:transparent;box-shadow:none}
    .wt-wrap[data-state=idle] .wt-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
    .wt-wrap[data-state=idle] .wt-action{margin-left:0;border:1px solid #b4deca;background:#edf8f2}
    .wt-wrap[data-state=idle] .wt-sound{background:transparent}
    .wt-wrap[data-state=busy]{border-color:#d9e5dd;background:#f6faf7}
    .wt-wrap[data-state=error]{border-color:#e8bfba;background:#fff7f6;color:#822d29}
    .wt-wrap[data-state=error] .wt-status{color:#822d29}
    .wt-wrap[data-state=success]{border-color:#b8dfc6;background:#f0f9f3}
    .wt-result{margin-top:8px;max-height:240px;padding-right:3px;font-size:13px;line-height:1.55;color:inherit}
    .wt-result[hidden]{display:none}
    @media(prefers-color-scheme:dark){
      .wt-wrap{background:#1c2b23;color:#eef7f1;border-color:#3b5344;box-shadow:none}
      .wt-status{color:#bfd4c5}
      .wt-action,.wt-retry,.wt-sound{color:#b8edce}
      .wt-action{background:#254c36}
      .wt-action:hover,.wt-retry:hover,.wt-sound:hover,.wt-action:active,.wt-retry:active,.wt-sound:active{background:#315c42}
      .wt-action:focus-visible,.wt-retry:focus-visible,.wt-sound:focus-visible,.wt-result:focus-visible{outline-color:#87d9ac}
      .wt-wrap[data-state=idle]{background:transparent;border-color:transparent}
      .wt-wrap[data-state=idle] .wt-action{border-color:#456f54;background:#234632}
      .wt-wrap[data-state=busy]{border-color:#3b5344;background:#26372b}
      .wt-wrap[data-state=error]{border-color:#75433f;background:#3a2524;color:#ffd5d1}
      .wt-wrap[data-state=error] .wt-status{color:#ffd5d1}
      .wt-wrap[data-state=success]{border-color:#326c49;background:#1d3c2c}
    }
    @media(prefers-reduced-motion:reduce){.wt-action,.wt-retry,.wt-sound{transition:none}}
  `;
  const SOUND_ON_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/></svg>`;
  const SOUND_OFF_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 9 5 6m0-6-5 6"/></svg>`;
  const SHARED_SHEET = (() => { try { if (typeof CSSStyleSheet !== "function") return null; const sheet = new CSSStyleSheet(); sheet.replaceSync(STYLE + SOUND_STYLE + UX_STYLE); return sheet; } catch (_) { return null; } })();
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
  const hashBytes = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  function base64(bytes) { let value = ""; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value); }
  function render(ui, state, text = "") {
    ui.host.dataset.state = state; ui.host.dataset.hasResult = state === "Transcrição" ? "true" : "false";
    ui.status.textContent = state; ui.result.textContent = text; ui.wrap.dataset.state = state === "Transcrição" ? "success" : state === "Erro" ? "error" : /Capturando|fila|Transcrevendo/.test(state) ? "busy" : "idle";
    ui.result.hidden = !text;
    ui.retry.hidden = state !== "Transcrição"; ui.retry.disabled = ["Capturando", "Na fila", "Transcrevendo"].some((value) => state.startsWith(value));
    if (["Capturando", "Na fila", "Transcrevendo"].some((value) => state.startsWith(value))) { ui.action.dataset.action = "cancel"; ui.action.textContent = "Cancelar"; }
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
    root.innerHTML = `${sharedStyles ? "" : `<style>${STYLE + SOUND_STYLE + UX_STYLE}</style>`}<div class="wt-wrap"><div class="wt-bar"><span class="wt-status" role="status" aria-live="polite"></span><button class="wt-action" type="button"></button><button class="wt-retry" type="button" hidden>Refazer</button><button class="wt-sound" type="button"></button></div><div class="wt-result" role="region" aria-label="Texto transcrito" tabindex="0"></div></div>`;
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
    ui.sound.innerHTML = muteAudio ? SOUND_OFF_ICON : SOUND_ON_ICON;
    ui.sound.title = muteAudio ? "Captura sem som. Ativar som" : "Captura com som. Desativar som";
    ui.sound.setAttribute("aria-label", ui.sound.title); ui.sound.setAttribute("aria-pressed", String(!muteAudio));
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
      const blob = await queueCapture(row, ui, tracked); if (tracked.canceled || !blob) return; const bytes = new Uint8Array(await blob.arrayBuffer()), audioHash = await hashBytes(bytes);
      if (!ignoreCache) { const cached = await runtime({ type: "CACHE_GET", messageId: expectedId, audioHash }); if (cached?.cached) { renderMessage(expectedId, "Transcrição", cached.cached.text); return; } }
      while (true) {
        renderMessage(expectedId, "Na fila", "Aguardando o worker local…"); const created = await runtime({ type: "CREATE_JOB", audioBase64: base64(bytes), mime: blob.type });
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
      const row = target && S.rowForNode(target);
      if (row) pendingRoots.add(row);
      for (const node of mutation.addedNodes || []) {
        const root = node?.querySelectorAll ? node : node?.parentElement;
        if (root && !root.dataset?.wtControl) pendingRoots.add(S.rowForNode(root) || root);
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
