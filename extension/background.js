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
async function dispatch(message) {
  switch (message.type) {
    case "HEALTH_CHECK": return { health: await api("/health") };
    case "CREATE_JOB": {
      await WTStorage.metric("attempts"); const form = new FormData(); form.append("audio", decodeAudio(message.audioBase64, message.mime), "whatsapp.ogg");
      const settings = await WTStorage.settingsGet(); form.append("glossary", JSON.stringify([...settings.defaultGlossary, ...settings.glossary]));
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
  dispatch(message).then((value) => sendResponse({ ok: true, ...value })).catch((error) => sendResponse({ ok: false, error: { code: error.code || "backend_unavailable", message: error.message || "Falha local", retryable: Boolean(error.retryable) } }));
  return true;
});
