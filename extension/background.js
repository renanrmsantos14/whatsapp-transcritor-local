try { importScripts("local-config.js"); } catch (_) {}
const WT_CONFIG = globalThis.LOCAL_CONFIG || { token: "" };
const WT_API = "http://127.0.0.1:8765";
const log = (event, details = {}) => console.info("[WT background]", event, details);

function allowedSender(sender, setup = false) {
  if (sender.id !== chrome.runtime.id) return false;
  if (setup) return !sender.tab;
  try {
    const url = new URL(sender.tab?.url || "");
    return url.protocol === "https:" && url.hostname === "web.whatsapp.com";
  } catch (_) { return false; }
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("X-Local-Token", WT_CONFIG.token || "");
  log("api_request", { path, method: init.method || "GET", bytes: init.body instanceof FormData ? init.body.get("audio")?.size || 0 : 0 });
  const response = await fetch(`${WT_API}${path}`, { ...init, headers });
  let body = null;
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) { log("api_error", { path, status: response.status, code: body?.error?.code || body?.detail?.error?.code || "unknown" }); throw new Error(body?.detail?.error?.message || body?.error?.message || `Backend HTTP ${response.status}`); }
  log("api_ok", { path, status: response.status });
  return body;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const setup = message?.type === "HEALTH_CHECK" && !sender.tab;
  if (!allowedSender(sender, setup)) { log("message_rejected", { type: message?.type || "unknown", senderUrl: sender.tab?.url || "no-tab", senderIdMatch: sender.id === chrome.runtime.id }); sendResponse({ ok: false, error: "sender_not_allowed" }); return false; }
  if (message.type === "HEALTH_CHECK") {
    api("/health").then((health) => sendResponse({ ok: true, health })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  const audio = message?.audio;
  const blobLike = audio && typeof audio.size === "number" && typeof audio.arrayBuffer === "function";
  if (message.type === "TRANSCRIBE_AUDIO" && blobLike) {
    const form = new FormData();
    form.append("audio", audio instanceof Blob ? audio : new Blob([audio], { type: audio.type || "audio/ogg" }), "whatsapp.ogg");
    api("/transcribe", { method: "POST", body: form })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  log("message_rejected", { type: message?.type || "unknown", reason: "unknown_message_or_audio" });
  sendResponse({ ok: false, error: "unknown_message" });
  return false;
});
