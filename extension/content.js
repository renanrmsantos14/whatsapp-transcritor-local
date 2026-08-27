(() => {
  "use strict";
  const S = WTSelectors, controls = new WeakMap(), active = new Map();
  const STYLE = `:host{display:block;font:12px system-ui;color:#111b21}.wrap{margin:4px 0;padding:7px 9px;border:1px solid #d8dfdf;border-radius:9px;background:#fff;max-width:390px}.bar{display:flex;gap:7px;align-items:center}.status{font-weight:650;flex:1}.result{white-space:pre-wrap;margin-top:6px;line-height:1.35}button{border:0;border-radius:7px;padding:5px 9px;cursor:pointer;background:#e6ecec;color:#111b21}button.primary{background:#0b6b5c;color:white}button[hidden]{display:none}.busy{opacity:.75}.error{border-color:#d9544d}.success{border-color:#3d927d}`;
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
    ui.status.textContent = state; ui.result.textContent = text; ui.wrap.className = `wrap ${state === "Transcrição" ? "success" : state === "Erro" ? "error" : /Capturando|fila|Transcrevendo/.test(state) ? "busy" : ""}`;
    ui.action.hidden = state !== "Pronto"; ui.cancel.hidden = !["Capturando", "Na fila", "Transcrevendo"].some((x) => state.startsWith(x)); ui.copy.hidden = state !== "Transcrição"; ui.retry.hidden = state !== "Erro";
  }
  function createUI(row) {
    const host = document.createElement("div"); host.dataset.wtControl = "true";
    const root = host.attachShadow({ mode: "closed" }); root.innerHTML = `<style>${STYLE}</style><div class="wrap"><div class="bar"><span class="status" role="status" aria-live="polite"></span><button class="primary action">Transcrever</button><button class="cancel" hidden>Cancelar</button><button class="copy" hidden>Copiar</button><button class="retry" hidden>Tentar novamente</button></div><div class="result"></div></div>`;
    const ui = { host, wrap: root.querySelector(".wrap"), status: root.querySelector(".status"), result: root.querySelector(".result"), action: root.querySelector(".action"), cancel: root.querySelector(".cancel"), copy: root.querySelector(".copy"), retry: root.querySelector(".retry"), jobId: null, canceled: false };
    for (const type of ["click", "pointerdown", "mousedown", "mouseup"]) host.addEventListener(type, (event) => event.stopPropagation());
    ui.action.onclick = ui.retry.onclick = () => run(row, ui); ui.cancel.onclick = () => cancel(ui); ui.copy.onclick = async () => { await navigator.clipboard.writeText(ui.result.textContent || ""); ui.copy.textContent = "Copiado"; setTimeout(() => ui.copy.textContent = "Copiar", 1000); };
    row.append(host); controls.set(row, ui); render(ui, "Pronto", "Clique para transcrever localmente."); restore(row, ui); return ui;
  }
  async function restore(row, ui) { const response = await runtime({ type: "CACHE_GET", messageId: S.messageId(row) }); if (response?.cached && row.isConnected) render(ui, "Transcrição", response.cached.text); }
  async function capture(row, ui, expectedId) {
    render(ui, "Capturando", "Obtendo o áudio do WhatsApp…"); if (!(await askPage("ping", {}, 2000)).ok) throw problem("capture_failed", "Recarregue a aba do WhatsApp.", true);
    let button = S.transportButton(row); if (!button) throw problem("capture_failed", "Controle de áudio não encontrado.", true);
    if (S.isDownloadButton(button)) { button.click(); await sleep(500); button = S.transportButton(row); }
    const pending = askPage("arm", { ms: 30000 }); button.click();
    try { const response = await pending; if (!response.ok || !response.blob) throw problem("capture_failed", "Áudio não capturado.", true); if (!row.isConnected || (expectedId && S.messageId(row) !== expectedId)) throw problem("canceled", "A conversa mudou durante a captura.", false); return response.blob; }
    finally { await askPage("hold", { ms: 2000 }, 2500); await askPage("silence", {}, 2500); await askPage("disarm", {}, 2500); }
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
          if (!row.isConnected || (expectedId && S.messageId(row) !== expectedId)) { await cancel(ui); return; }
          if (job.state === "completed") { render(ui, "Transcrição", job.result.text); return; }
          if (job.state === "failed") throw job.error; if (job.state === "canceled") { render(ui, "Cancelado", "Transcrição cancelada."); return; }
          render(ui, `Transcrevendo · ${Math.floor((Date.now() - started) / 1000)}s`, job.stage === "preparing" ? "Preparando modelo…" : "Processando localmente…"); await sleep(Date.now() - started < 10000 ? 1000 : 2000);
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
