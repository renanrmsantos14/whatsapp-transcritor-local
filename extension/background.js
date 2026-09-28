importScripts("protocol.js", "storage.js");
try { importScripts("local-config.js"); } catch (_) {}
const CONFIG = globalThis.LOCAL_CONFIG || { token: "" };
const WT_API = "http://127.0.0.1:8765";
const MAX_BASE64 = Math.ceil(25 * 1024 * 1024 * 4 / 3) + 4;
chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
WTStorage.migrate().catch(() => {});

function allowed(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  if (!sender.tab) return true;
  try { const url = new URL(sender.tab.url); return url.protocol === "https:" && url.hostname === "web.whatsapp.com"; } catch (_) { return false; }
}
async function api(path, init = {}) {
  const headers = new Headers(init.headers || {}); headers.set("X-Local-Token", CONFIG.token || "");
  let response;
  try { response = await fetch(`${WT_API}${path}`, { ...init, headers }); }
  catch (_) { throw { code: "backend_unavailable", message: "Backend local indisponível", retryable: true }; }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw body?.error || { code: "backend_unavailable", message: `Backend HTTP ${response.status}`, retryable: response.status >= 500 };
  return body;
}
function decodeAudio(value, mime) {
  if (typeof value !== "string" || !value || value.length > MAX_BASE64) throw { code: "file_too_large", message: "Áudio inválido ou muito grande", retryable: false };
  try { const binary = atob(value), bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return new Blob([bytes], { type: mime || "audio/ogg" }); }
  catch (_) { throw { code: "capture_failed", message: "Codificação de áudio inválida", retryable: false }; }
}
async function dispatch(message, sender) {
  switch (message.type) {
    case "ASSISTANT_PANEL": {
      if (sender.tab) throw { code: "sender_not_allowed", message: "Abra o painel pelo ícone da extensão." };
      const result = await api("/assistant/api/ticket", { method: "POST" });
      await chrome.tabs.create({ url: `${WT_API}/assistant#${encodeURIComponent(result.ticket)}` });
      return {};
    }
    case "ASSISTANT_BINDINGS_GET": {
      if (!sender.tab) throw { code: "sender_not_allowed", message: "Origem inválida." };
      const saved = await chrome.storage.local.get({ assistantOpaqueBindings: {} });
      return { bindings: saved.assistantOpaqueBindings };
    }
    case "ASSISTANT_BINDINGS_SAVE": {
      if (!sender.tab || !Array.isArray(message.ids) || message.ids.length > 500 ||
          message.ids.some(id => typeof id !== "string" || !id || id.length > 500) ||
          typeof message.conversationId !== "string" || !/^local:[a-f0-9-]{36}$/.test(message.conversationId) ||
          typeof message.name !== "string" || message.name.length > 160) throw { code: "invalid_request", message: "Vínculos inválidos." };
      const saved = await chrome.storage.local.get({ assistantOpaqueBindings: {} });
      const bindings = Object.assign(Object.create(null), saved.assistantOpaqueBindings);
      for (const id of message.ids) bindings[id] = { id: message.conversationId, name: message.name };
      await chrome.storage.local.set({ assistantOpaqueBindings: bindings });
      return {};
    }
    case "ASSISTANT_PERMISSION": {
      return { permission: await api(`/assistant/api/permission/${encodeURIComponent(message.conversationId)}`) };
    }
    case "ASSISTANT_LOCAL_ENABLE": {
      const conversation = message.conversation;
      if (!sender.tab || !conversation || typeof conversation.id !== "string" || typeof conversation.name !== "string") throw { code: "invalid_request", message: "Conversa inválida." };
      const permission = await api(`/assistant/api/permission/${encodeURIComponent(conversation.id)}`);
      if (message.automatic) return await api("/assistant/api/auto-collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: conversation.id, name: conversation.name, collect: true, external: false }) });
      if (!permission.collect) await api("/assistant/api/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: conversation.id, name: conversation.name, collect: true, external: false }) });
      return {};
    }
    case "ASSISTANT_INGEST": {
      if (!sender.tab || !Array.isArray(message.messages) || message.messages.length > 500) throw { code: "invalid_request", message: "Lote inválido." };
      const permission = await api(`/assistant/api/permission/${encodeURIComponent(message.conversationId)}`);
      if (!permission.collect) throw { code: "unauthorized", message: "Coleta não autorizada." };
      // Only existing cache is read; this path never creates a transcription job.
      const messages = [];
      for (const source of message.messages) {
        const item = { ...source };
        if (item.kind === "audio") {
          const cached = await WTStorage.cacheGet(item.id, null);
          item.text = cached?.text || "";
          item.audio_missing = !item.text;
        }
        messages.push(item);
      }
      for (let start = 0; start < messages.length; start += 5) await api("/assistant/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: message.conversationId, messages: messages.slice(start, start + 5) }) });
      return {};
    }
    case "HEALTH_CHECK": return { health: await api("/health") };
    case "CREATE_JOB": {
      await WTStorage.metric("attempts"); const form = new FormData(); form.append("audio", decodeAudio(message.audioBase64, message.mime), "whatsapp.ogg");
      const settings = await WTStorage.settingsGet(); form.append("glossary", JSON.stringify([...settings.defaultGlossary, ...settings.glossary])); form.append("transcription_mode", settings.transcriptionMode);
      return { job: await api("/jobs", { method: "POST", body: form }) };
    }
    case "GET_JOB": {
      const job = await api(`/jobs/${encodeURIComponent(message.jobId)}`);
      if (job.state === "completed") { await WTStorage.cacheSet(message.messageId, message.audioHash, job.result); await WTStorage.metric("successes"); }
      if (job.state === "failed") await WTStorage.metric("failures", job.error);
      return { job };
    }
    case "CANCEL_JOB": { const job = await api(`/jobs/${encodeURIComponent(message.jobId)}`, { method: "DELETE" }); await WTStorage.metric("cancellations"); return { job }; }
    case "CACHE_GET": return { cached: await WTStorage.cacheGet(message.messageId, message.audioHash) };
    case "CACHE_CLEAR": await WTStorage.clear(); return {};
    case "SETTINGS_GET": return { settings: await WTStorage.settingsGet(), extensionVersion: WTProtocol.EXTENSION_VERSION };
    case "SETTINGS_UPDATE": return { settings: await WTStorage.settingsUpdate(message.settings || {}) };
    case "DIAGNOSTICS_GET": return { diagnostics: await WTStorage.diagnostics() };
    default: throw { code: "invalid_request", message: "Mensagem desconhecida", retryable: false };
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!allowed(sender) || !WTProtocol.isKnown(message?.type)) { sendResponse({ ok: false, error: { code: "sender_not_allowed", message: "Origem não permitida", retryable: false } }); return false; }
  dispatch(message, sender).then((value) => sendResponse({ ok: true, ...value })).catch((error) => sendResponse({ ok: false, error: { code: error.code || "backend_unavailable", message: error.message || "Falha local", retryable: Boolean(error.retryable) } }));
  return true;
});
