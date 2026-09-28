/* Passive collector. Never navigates, scrolls, downloads, plays, or sends WhatsApp messages. */
(() => {
  "use strict";
  const send = (message) => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError || !response?.ok) reject(new Error(response?.error?.message || "Serviço local indisponível"));
    else resolve(response);
  }));
  const chatId = (id) => /^(?:true|false|incoming|outgoing)_([^_]+)_/.exec(id || "")?.[1] || null;
  function timestamp(raw, lang = document.documentElement.lang) {
    const match = /^\[(\d{1,2}):(\d{2})(?::\d{2})?,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]\s*(.*?):\s*$/.exec(raw || "");
    if (!match || !lang?.startsWith("pt")) return { sent_at: null, author: "Desconhecido", missing: true };
    const [, hh, mm, dd, mo, yy, author] = match;
    const iso = `${yy}-${mo.padStart(2, "0")}-${dd.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm}:00-03:00`;
    const date = new Date(iso);
    const valid = Number(dd) > 0 && Number(mo) > 0 && Number(mo) <= 12 && Number(hh) < 24 && Number(mm) < 60 && !Number.isNaN(date.getTime()) &&
      new Date(`${yy}-${mo.padStart(2, "0")}-${dd.padStart(2, "0")}T00:00:00Z`).getUTCDate() === Number(dd);
    return { sent_at: valid ? iso : null, author: author || "Desconhecido", missing: !valid || !author };
  }
  // Export only pure parsing for the small Node check; browser operations stay isolated.
  globalThis.WTAssistantCollector = { chatId, timestamp };
  if (typeof chrome === "undefined" || !chrome.runtime) return;
  const opaqueBindings = {};
  let bindingsReady = false, bindingsError = "";
  // Storage is restricted to trusted extension contexts; use the background bridge.
  Promise.resolve().then(() => send({ type: "ASSISTANT_BINDINGS_GET" })).then(value => {
    const saved = value.bindings;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.assign(opaqueBindings, saved);
    bindingsReady = true;
    schedule();
  }).catch(error => {
    bindingsError = error.message || "Falha ao carregar vínculos locais.";
    schedule();
  });
  let timer, running = false, again = false, current = null;
  const toolbar = document.createElement("div"); toolbar.id = "wt-assistant-bar";
  Object.assign(toolbar.style, { position: "fixed", bottom: "12px", right: "20px", zIndex: "9999", background: "#fff", color: "#18392e", border: "1px solid #bacfc5", padding: "8px 12px", borderRadius: "8px", font: "13px system-ui", boxShadow: "0 2px 8px #0002", maxWidth: "330px" });
  const detail = document.createElement("p"); detail.style.margin = "4px 0 0"; detail.setAttribute("role", "status");
  detail.textContent = "Coleta automática local: abra uma conversa.";
  toolbar.append(detail); document.body.append(toolbar);

  function messageRows(root) {
    const anchors = [...root.querySelectorAll("[data-pre-plain-text]")]
      .map(node => node.closest?.("[data-id]"))
      .filter(node => node && root.contains?.(node));
    const legacy = [...root.querySelectorAll("[data-id]")].filter(row => {
      if (!chatId(row.getAttribute("data-id"))) return false;
      for (let parent = row.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (chatId(parent.getAttribute?.("data-id"))) return false;
      }
      return true;
    });
    return [...new Set([...anchors, ...legacy])];
  }

  function descriptor() {
    const roots = [document.querySelector("#main"), document.querySelector("main"), document.querySelector('[role="main"]')].filter(Boolean);
    // Locate the conversation through its composer when WhatsApp changes the main wrapper.
    let parent = document.querySelector('footer [contenteditable="true"]')?.parentElement;
    while (parent && parent !== document.body) {
      if (parent.querySelector("header") && messageRows(parent).length) { roots.push(parent); break; }
      parent = parent.parentElement;
    }
    for (const main of [...new Set(roots)]) {
      const rows = messageRows(main);
      const ids = [...new Set(rows.map((row) => chatId(row.getAttribute("data-id"))))];
      if (!rows.length || !bindingsReady) continue;
      const heading = main.querySelector('header span[dir="auto"]') || main.querySelector("header span[title]");
      const name = heading?.getAttribute("title") || heading?.textContent?.trim();
      if (!name) continue;
      if (ids.every(Boolean)) {
        if (ids.length !== 1) continue;
        return { id: ids[0], name: name.slice(0, 160), rows };
      }
      if (ids.some(Boolean)) continue;
      // Opaque IDs: associate by exact previously observed message IDs, never name alone.
      const matches = [...new Set(rows.map(row => opaqueBindings[row.getAttribute("data-id")])
        .filter(binding => binding && (binding.name === name || ["Profile details", "Dados do perfil", "Detalhes do perfil"].includes(binding.name))).map(binding => binding.id))];
      if (matches.length > 1) continue;
      const id = matches[0] || `local:${crypto.randomUUID()}`;
      for (const row of rows) opaqueBindings[row.getAttribute("data-id")] = { id, name };
      return { id, name: name.slice(0, 160), rows };
    }
    return null;
  }

  function extract(row) {
    const id = row.getAttribute("data-id");
    const metadata = row.querySelector("[data-pre-plain-text]") || (row.hasAttribute("data-pre-plain-text") ? row : null);
    const raw = metadata?.getAttribute("data-pre-plain-text") || "";
    const parsed = timestamp(raw);
    const quote = row.querySelector('[data-testid="quoted-message"], [data-testid="quoted-message-container"], [data-testid="quoted-message-text"], [data-testid="quoted-msg"]');
    const quoted = quote?.textContent?.trim() || "";
    const textNodes = [...row.querySelectorAll(".selectable-text")].filter((node) => !node.closest(".wt-wrap") && !quote?.contains(node) && !node.parentElement?.closest(".selectable-text"));
    const text = textNodes.map((node) => node.textContent).join("\n").trim();
    const voice = Boolean(row.querySelector('[data-icon*="ptt-status"], [data-testid*="audio"], audio, [aria-label*="mensagem de voz" i], [aria-label*="voice message" i]'));
    const opaque = !chatId(id);
    const outgoing = /^(?:true|outgoing)_/.test(id) || Boolean(row.matches?.(".message-out") || row.querySelector(".message-out") || row.closest?.(".message-out"));
    return { id, author: outgoing ? "Eu" : parsed.author, outgoing, sent_at: parsed.sent_at,
      time_raw: raw.replace(/\]\s*.*$/, "]"), text, quoted, kind: voice ? "audio" : "text",
      audio_missing: voice, metadata_missing: parsed.missing || (opaque && !outgoing && !row.matches?.(".message-in") && !row.querySelector(".message-in") && !row.closest?.(".message-in")) || (!text && !voice) };
  }

  async function collect() {
    if (running) { again = true; return; }
    running = true;
    try {
      if (bindingsError) { detail.textContent = bindingsError; return; }
      const selected = descriptor(); current = selected;
      toolbar.hidden = false;
      if (!selected) {
        const nodes = [...document.querySelectorAll("[data-id]")];
        const known = nodes.filter(node => chatId(node.getAttribute("data-id"))).length;
        const jid = nodes.filter(node => /@(?:c\.us|g\.us|lid|s\.whatsapp\.net)/.test(node.getAttribute("data-id") || "")).length;
        const metadata = document.querySelectorAll("[data-pre-plain-text]").length;
        const rows = document.querySelectorAll('[role="row"]').length;
        const main = document.querySelector("#main") || document.querySelector("main") || document.querySelector('[role="main"]');
        const scoped = main ? messageRows(main).length : 0;
        const header = !!main?.querySelector("header");
        detail.textContent = `Diagnóstico de coleta: IDs=${nodes.length}; reconhecidos=${known}; endereços=${jid}; metadados=${metadata}; linhas=${rows}; painel=${!!main}; cabeçalho=${header}; mensagens=${scoped}; pronto=${bindingsReady}. Sem identificação segura da conversa.`;
        return;
      }
      let { permission } = await send({ type: "ASSISTANT_PERMISSION", conversationId: selected.id });
      // Authorization check happens before extracting any message bodies.
      if (descriptor()?.id !== selected.id) return;
      if ((permission.collect && selected.id.startsWith("local:")) || (!permission.collect && !permission.exists && !permission.excluded)) {
        const result = await send({ type: "ASSISTANT_LOCAL_ENABLE", automatic: true, conversation: { id: selected.id, name: selected.name } });
        if (descriptor()?.id !== selected.id) return;
        permission = { collect: result.collect === true };
      }
      if (!permission.collect) { detail.textContent = "Conversa excluída ou coleta pausada no painel."; return; }
      const messages = selected.rows.map(extract);
      if (!messages.length) return;
      if (descriptor()?.id !== selected.id) return;
      await send({ type: "ASSISTANT_INGEST", conversationId: selected.id, messages });
      if (selected.id.startsWith("local:")) await send({ type: "ASSISTANT_BINDINGS_SAVE", conversationId: selected.id, name: selected.name, ids: messages.map(message => message.id) });
      detail.textContent = `${messages.length} mensagens renderizadas · histórico parcial · coleta local.`;
    } catch (error) { detail.textContent = error.message; }
    finally { running = false; if (again) { again = false; schedule(); } }
  }
  function schedule() {
    // Continuous WhatsApp mutations must not postpone collection indefinitely.
    if (timer) return;
    timer = setTimeout(() => { timer = null; return collect(); }, 1200);
  }
  new MutationObserver((records) => {
    if (records.some((record) => !toolbar.contains(record.target))) schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-id", "data-pre-plain-text"] });
  setInterval(schedule, 15000); // Refresh consent even when the DOM hasn't changed.
  schedule();
})();
