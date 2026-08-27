try { importScripts("local-config.js"); } catch (_) {}
const WT_CONFIG = globalThis.LOCAL_CONFIG || { token: "" };
const WT_API = "http://127.0.0.1:8765";

function allowedSender(sender, setup = false) {
  if (sender.id !== chrome.runtime.id) return false;
  if (setup) return !sender.tab;
  return Boolean(sender.tab?.url?.startsWith("https://web.whatsapp.com/"));
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("X-Local-Token", WT_CONFIG.token || "");
  const response = await fetch(`${WT_API}${path}`, { ...init, headers });
  let body = null;
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(body?.detail?.error?.message || body?.error?.message || `Backend HTTP ${response.status}`);
  return body;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const setup = message?.type === "HEALTH_CHECK";
  if (!allowedSender(sender, setup)) { sendResponse({ ok: false, error: "sender_not_allowed" }); return false; }
  if (message.type === "HEALTH_CHECK") {
    api("/health").then((health) => sendResponse({ ok: true, health })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "TRANSCRIBE_AUDIO" && message.audio instanceof Blob) {
    const form = new FormData();
    form.append("audio", message.audio, "whatsapp.ogg");
    api("/transcribe", { method: "POST", body: form })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  sendResponse({ ok: false, error: "unknown_message" });
  return false;
});
