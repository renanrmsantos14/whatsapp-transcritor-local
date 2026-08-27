(() => {
  "use strict";
  const S = WTSelectors, controls = new WeakMap(), active = new Map();
  const STYLE = `:host{display:block}.wt-wrap{box-sizing:border-box;width:min(390px,calc(100% - 16px));margin:6px 0 8px;padding:10px 14px 12px;border:1px solid rgba(0,0,0,.08);border-radius:10px;background:rgba(255,255,255,.82);color:inherit;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.04);user-select:text}.wt-bar{display:flex;align-items:center;gap:6px;min-height:26px}.wt-status{color:rgba(0,0,0,.62);font-size:11px;font-weight:650;letter-spacing:.01em;white-space:nowrap}.wt-result{margin-top:7px;max-height:190px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;scrollbar-width:thin;cursor:text}.wt-action,.wt-copy,.wt-retry,.wt-cancel{min-height:30px;border:0;border-radius:7px;background:transparent;color:#087f5b;cursor:pointer;font:600 11px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;padding:6px 8px}.wt-action{margin-left:auto;background:rgba(8,127,91,.1)}.wt-copy,.wt-cancel{margin-left:auto}.wt-retry{margin-left:4px}.wt-action:hover,.wt-copy:hover,.wt-retry:hover,.wt-cancel:hover{background:rgba(8,127,91,.16)}button[hidden]{display:none}.wt-wrap[data-state=busy]{background:rgba(0,0,0,.035)}.wt-wrap[data-state=error]{background:rgba(180,45,35,.08);border-color:rgba(180,45,35,.2);color:#8b1e1e}.wt-wrap[data-state=success]{background:rgba(8,127,91,.055);border-color:rgba(8,127,91,.18)}.wt-wrap[data-direction=outgoing]{margin-left:auto}.wt-wrap[data-direction=incoming]{margin-left:0}@media(prefers-color-scheme:dark){.wt-wrap{border-color:rgba(255,255,255,.13);background:rgba(35,35,34,.86)}.wt-status{color:rgba(255,255,255,.68)}.wt-action,.wt-copy,.wt-retry,.wt-cancel{color:#76d2ae}.wt-wrap[data-state=success]{background:rgba(90,220,150,.1)}}`;
  const runtime = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => resolve(chrome.runtime.lastError ? { ok: false, error: { code: "backend_unavailable", message: chrome.runtime.lastError.message, retryable: true } } : response)));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const askPage = (action, extra = {}, timeout = 35000) => new Promise((resolve) => {
    const id = crypto.randomUUID(), listener = (event) => { if (event.source === window && event.data?.__wt === "response" && event.data.id === id) { clearTimeout(timer); removeEventListener("message", listener); resolve(event.data); } };
    addEventListener("message", listener); postMessage({ __wt: "request", id, action, ...extra }, "*");
    const timer = setTimeout(() => { removeEventListener("message", listener); resolve({ ok: false, error: "timeout" }); }, timeout);
  });
  const hashBlob = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function base64(blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); let value = ""; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value); }
  function render(ui, state, text = "") {
    ui.host.dataset.state = state; ui.host.dataset.hasResult = state === "Transcrição" ? "true" : "false";
    ui.status.textContent = state; ui.result.textContent = text; ui.wrap.dataset.state = state === "Transcrição" ? "success" : state === "Erro" ? "error" : /Capturando|fila|Transcrevendo/.test(state) ? "busy" : "idle";
    ui.action.hidden = state !== "Pronto"; ui.cancel.hidden = !["Capturando", "Na fila", "Transcrevendo"].some((x) => state.startsWith(x)); ui.copy.hidden = state !== "Transcrição"; ui.retry.hidden = state !== "Erro";
  }
  function createUI(row) {
    const host = document.createElement("div"); host.dataset.wtControl = "true";
    const root = host.attachShadow({ mode: "closed" }); root.innerHTML = `<style>${STYLE}</style><div class="wt-wrap"><div class="wt-bar"><span class="wt-status" role="status" aria-live="polite"></span><button class="wt-action">Transcrever</button><button class="wt-cancel" hidden>Cancelar</button><button class="wt-copy" hidden>Copiar</button><button class="wt-retry" hidden>Tentar novamente</button></div><div class="wt-result"></div></div>`;
    const ui = { host, wrap: root.querySelector(".wt-wrap"), status: root.querySelector(".wt-status"), result: root.querySelector(".wt-result"), action: root.querySelector(".wt-action"), cancel: root.querySelector(".wt-cancel"), copy: root.querySelector(".wt-copy"), retry: root.querySelector(".wt-retry"), jobId: null, canceled: false };
    for (const type of ["click", "pointerdown", "mousedown", "mouseup"]) host.addEventListener(type, (event) => event.stopPropagation());
    ui.action.onclick = ui.retry.onclick = () => run(row, ui); ui.cancel.onclick = () => cancel(ui); ui.copy.onclick = async () => { await navigator.clipboard.writeText(ui.result.textContent || ""); ui.copy.textContent = "Copiado"; setTimeout(() => ui.copy.textContent = "Copiar", 1000); };
    ui.wrap.dataset.direction = S.isOutgoing(row) ? "outgoing" : "incoming";
    row.append(host); controls.set(row, ui); render(ui, "Pronto", "Clique em Transcrever. O áudio não será reproduzido."); restore(row, ui); return ui;
  }
  async function restore(row, ui) { const response = await runtime({ type: "CACHE_GET", messageId: S.messageId(row) }); if (response?.cached && row.isConnected) render(ui, "Transcrição", response.cached.text); }
  async function capture(row, ui, expectedId) {
    render(ui, "Capturando", "Obtendo o áudio do WhatsApp…"); if (!(await askPage("ping", {}, 2000)).ok) throw problem("capture_failed", "Recarregue a aba do WhatsApp.", true);
    const button = S.transportButton(row); if (!button) throw problem("capture_failed", "Controle de áudio não encontrado.", true);
    const marker = crypto.randomUUID(); row.dataset.wtCapture = marker;
    const armed = await askPage("arm", { ms: 30000, marker }, 2000); if (!armed.ok) throw problem("capture_failed", "Captura local não foi armada.", true);
    const pending = askPage("capture", {}, 35000);
    if (S.isDownloadButton(button)) button.click();
    try { const response = await pending; if (!response.ok || !response.blob) throw problem("capture_failed", "Áudio não capturado.", true); if (!row.isConnected || (expectedId && S.messageId(row) !== expectedId)) throw problem("canceled", "A conversa mudou durante a captura.", false); return response.blob; }
    finally { delete row.dataset.wtCapture; await askPage("disarm", {}, 2500); }
  }
  function problem(code, message, retryable) { return { code, message, retryable }; }
  async function cancel(ui) { ui.canceled = true; if (ui.jobId) await runtime({ type: "CANCEL_JOB", jobId: ui.jobId }); render(ui, "Cancelado", "Transcrição cancelada."); }
  async function run(row, ui, attempt = 0) {
    if (active.has(row)) return; active.set(row, true); ui.canceled = false; const expectedId = S.messageId(row);
    try {
      const blob = await capture(row, ui, expectedId), audioHash = await hashBlob(blob); if (ui.canceled) return;
      const cached = await runtime({ type: "CACHE_GET", messageId: expectedId, audioHash }); if (cached?.cached) { render(ui, "Transcrição", cached.cached.text); return; }
      while (true) {
        render(ui, "Na fila", "Aguardando o worker local…"); const created = await runtime({ type: "CREATE_JOB", audioBase64: await base64(blob), mime: blob.type });
        if (!created?.ok) throw created.error; ui.jobId = created.job.job_id;
        const started = Date.now();
        while (!ui.canceled) {
          const response = await runtime({ type: "GET_JOB", jobId: ui.jobId, messageId: expectedId, audioHash }); if (!response?.ok) throw response.error; const job = response.job;
          const canRender = row.isConnected && (!expectedId || S.messageId(row) === expectedId);
          if (job.state === "completed") { if (canRender) render(ui, "Transcrição", job.result.text); return; }
          if (job.state === "failed") { if (canRender) throw job.error; return; }
          if (job.state === "canceled") { if (canRender) render(ui, "Cancelado", "Transcrição cancelada."); return; }
          if (canRender) render(ui, `Transcrevendo · ${Math.floor((Date.now() - started) / 1000)}s`, job.stage === "preparing" ? "Preparando modelo…" : "Processando localmente…");
          await sleep(Date.now() - started < 10000 ? 1000 : 2000);
        }
        return;
      }
    } catch (error) {
      if (error?.retryable && attempt < 1 && !ui.canceled) { active.delete(row); return run(row, ui, attempt + 1); }
      if (!ui.canceled) render(ui, "Erro", error?.message || "Não foi possível transcrever.");
    } finally { ui.jobId = null; active.delete(row); }
  }
  function scan() { for (const row of S.rows()) if (!controls.has(row) || !controls.get(row).host.isConnected) createUI(row); }
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.body, { childList: true, subtree: true }); scan();
})();
