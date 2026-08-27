(() => {
  "use strict";
  const S = globalThis.WTSelectors;
  const CACHE_PREFIX = "wt:v1:";
  const CACHE_LIMIT = 1000;
  const rowIds = new WeakMap();
  const pending = [];
  const queued = new Set();
  let active = false;
  let sequence = 0;
  let fallbackRowSequence = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const askPage = (action, extra = {}, timeout = 5000) => new Promise((resolve) => {
    const id = ++sequence;
    const listener = (event) => {
      if (event.source !== window || event.data?.__wt !== "response" || event.data.id !== id) return;
      window.removeEventListener("message", listener);
      resolve(event.data);
    };
    window.addEventListener("message", listener);
    window.postMessage({ __wt: "request", id, action, ...extra }, "*");
    setTimeout(() => { window.removeEventListener("message", listener); resolve({ ok: false, error: "timeout" }); }, timeout);
  });
  const runtime = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  const keyFor = (id) => id ? `${CACHE_PREFIX}id:${id}` : null;
  const hashBlob = async (blob) => {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  async function cacheGet(key) { if (!key) return null; return (await chrome.storage.local.get(key))[key] || null; }
  async function cacheSet(record, id, hash) {
    const value = { ...record, lastAccessedAt: Date.now() };
    const values = {};
    if (id) values[keyFor(id)] = value;
    if (hash) values[`${CACHE_PREFIX}hash:${hash}`] = value;
    await chrome.storage.local.set(values);
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((key) => key.startsWith(CACHE_PREFIX));
    if (keys.length > CACHE_LIMIT * 2) await chrome.storage.local.remove(keys.sort((a, b) => (all[a].lastAccessedAt || 0) - (all[b].lastAccessedAt || 0)).slice(0, keys.length - CACHE_LIMIT * 2));
  }
  const textNode = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text != null) node.textContent = text; return node; };
  function makeUI(row) {
    const wrap = textNode("div", "wt-wrap");
    const status = textNode("span", "wt-status");
    const result = textNode("div", "wt-result");
    const copy = textNode("button", "wt-copy", "Copiar");
    copy.type = "button";
    copy.hidden = true;
    const retry = textNode("button", "wt-retry", "Tentar novamente");
    retry.type = "button";
    retry.hidden = true;
    const bar = textNode("div", "wt-bar");
    bar.append(textNode("span", "wt-icon", "📝"), status, copy, retry);
    wrap.append(bar, result);
    ["click", "mousedown", "mouseup", "pointerdown", "dblclick"].forEach((type) => wrap.addEventListener(type, (event) => event.stopPropagation()));
    copy.addEventListener("click", () => navigator.clipboard.writeText(result.textContent || ""));
    retry.addEventListener("click", () => enqueue(row, true));
    row.appendChild(wrap);
    wrap.dataset.messageId = S.messageId(row) || "";
    return { wrap, status, result, copy, retry };
  }
  function render(ui, state, text = "") {
    ui.status.textContent = state;
    ui.result.textContent = text;
    ui.copy.hidden = state !== "Transcrição";
    ui.retry.hidden = state !== "Não foi possível transcrever.";
    ui.wrap.dataset.state = state === "Transcrição" ? "success" : state === "Não foi possível transcrever." ? "error" : "busy";
  }
  function rowKey(row) { if (!rowIds.has(row)) rowIds.set(row, `row-${Date.now()}-${++fallbackRowSequence}`); return S.messageId(row) || rowIds.get(row); }
  async function ensureHealth() {
    const response = await runtime({ type: "HEALTH_CHECK" });
    if (!response?.ok || !response.health?.ready) throw new Error("Transcritor local indisponível.");
  }
  async function capture(row, ui) {
    const hook = await askPage("ping", {}, 2000);
    if (!hook.ok) throw new Error("Recarregue a aba do WhatsApp para ativar a captura.");
    const button = S.transportButton(row);
    if (!button) throw new Error("Controle de áudio não encontrado.");
    if (S.isDownloadButton(button)) { render(ui, "Transcrevendo…"); button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true })); button.click(); await sleep(500); }
    const captured = askPage("arm", { ms: 30000 }, 35000);
    const playButton = S.transportButton(row);
    if (!playButton) throw new Error("Controle de reprodução não encontrado.");
    playButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    playButton.click();
    try {
      const response = await captured;
      if (!response.ok || !response.blob) throw new Error(response.error || "Áudio não capturado.");
      return response.blob;
    } finally { await askPage("hold", { ms: 2000 }); await askPage("silence"); await askPage("disarm"); }
  }
  async function process(row, ui) {
    const id = S.messageId(row);
    const cached = await cacheGet(keyFor(id));
    if (cached) { render(ui, "Transcrição", cached.text); return; }
    await ensureHealth();
    render(ui, "Transcrevendo…");
    const blob = await capture(row, ui);
    const hash = await hashBlob(blob);
    const hashCached = await cacheGet(`${CACHE_PREFIX}hash:${hash}`);
    if (hashCached) { render(ui, "Transcrição", hashCached.text); if (id) await cacheSet(hashCached, id, hash); return; }
    const response = await runtime({ type: "TRANSCRIBE_AUDIO", audio: blob });
    if (!response?.ok || !response.result?.success) throw new Error(response?.error || "Backend indisponível.");
    const record = { version: 1, messageId: id, audioHash: hash, text: response.result.text, language: response.result.language, createdAt: Date.now() };
    await cacheSet(record, id, hash);
    render(ui, "Transcrição", record.text);
  }
  async function drain() {
    if (active) return;
    active = true;
    while (pending.length) {
      const job = pending.shift(); queued.delete(job.key);
      try { await process(job.row, job.ui); } catch (error) { render(job.ui, "Não foi possível transcrever.", error.message); }
    }
    active = false;
  }
  function enqueue(row, force = false) {
    if (!S.isVoiceNote(row) || S.isOutgoing(row)) return;
    let ui = row.querySelector(".wt-wrap");
    if (!ui) ui = makeUI(row);
    const key = rowKey(row);
    if (!force && queued.has(key)) return;
    if (force) pending.splice(0, pending.length, ...pending.filter((job) => job.key !== key));
    queued.add(key); pending.push({ row, ui: { wrap: ui, status: ui.querySelector(".wt-status"), result: ui.querySelector(".wt-result"), copy: ui.querySelector(".wt-copy"), retry: ui.querySelector(".wt-retry") }, key }); drain();
  }
  function scan() {
    for (const row of S.rows()) {
      const existing = row.querySelector(".wt-wrap");
      const id = S.messageId(row) || "";
      if (existing && existing.dataset.messageId === id) continue;
      if (existing) existing.remove();
      enqueue(row);
    }
  }
  let scheduled = false;
  const schedule = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; scan(); }); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  setInterval(() => { if (document.visibilityState === "visible") scan(); }, 4000);
  scan();
})();
