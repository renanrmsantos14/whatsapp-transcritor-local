(() => {
  "use strict";
  const PREFIX = "wt:v2:", V1 = "wt:v1:", TTL = 7 * 86400000, LIMIT = 500, MAX_BYTES = 8 * 1024 * 1024;
  const DEFAULT_TERMS = ["Betinhos", "Congonhas", "Guarulhos", "Viracopos", "GRU", "CGH", "VCP", "Dataverse", "Power Apps", "Power Automate", "SharePoint"];
  const get = (keys) => chrome.storage.local.get(keys), set = (values) => chrome.storage.local.set(values), remove = (keys) => chrome.storage.local.remove(keys);
  const sha = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function prune() {
    const all = await get(null), now = Date.now();
    const transcripts = Object.entries(all).filter(([key]) => key.startsWith(`${PREFIX}transcript:`));
    const expired = transcripts.filter(([, value]) => Number(value.expiresAt) <= now).map(([key]) => key);
    if (expired.length) await remove(expired);
    const fresh = transcripts.filter(([key]) => !expired.includes(key)).sort((a, b) => (a[1].lastAccessedAt || 0) - (b[1].lastAccessedAt || 0));
    let bytes = new Blob([JSON.stringify(all)]).size;
    const excess = [];
    while (fresh.length - excess.length > LIMIT || bytes > MAX_BYTES) { const [key, value] = fresh[excess.length]; excess.push(key); bytes -= new Blob([JSON.stringify(value)]).size; }
    if (excess.length) await remove(excess);
  }
  async function migrate() {
    const all = await get(null), writes = {}, deletes = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(V1) || !value?.text || Date.now() - Number(value.createdAt || 0) > TTL) continue;
      const audioHash = value.audioHash || await sha(value.text);
      writes[`${PREFIX}transcript:${audioHash}`] = { text: value.text, language: value.language || "", createdAt: value.createdAt, expiresAt: Number(value.createdAt) + TTL, lastAccessedAt: Date.now() };
      if (value.messageId) writes[`${PREFIX}message:${await sha(value.messageId)}`] = { audioHash, expiresAt: Number(value.createdAt) + TTL };
      deletes.push(key);
    }
    if (Object.keys(writes).length) await set(writes);
    if (deletes.length) await remove(deletes);
    await prune();
  }
  async function cacheGet(messageId, audioHash) {
    const messageKey = messageId ? `${PREFIX}message:${await sha(messageId)}` : null;
    const pointer = messageKey ? (await get(messageKey))[messageKey] : null;
    const hash = audioHash || pointer?.audioHash;
    if (!hash) return null;
    const key = `${PREFIX}transcript:${hash}`, value = (await get(key))[key];
    if (!value || Number(value.expiresAt) <= Date.now()) { if (value) await remove(key); return null; }
    value.lastAccessedAt = Date.now(); await set({ [key]: value }); return value;
  }
  async function cacheSet(messageId, audioHash, result) {
    const now = Date.now(), values = { [`${PREFIX}transcript:${audioHash}`]: { ...result, createdAt: now, expiresAt: now + TTL, lastAccessedAt: now } };
    if (messageId) values[`${PREFIX}message:${await sha(messageId)}`] = { audioHash, expiresAt: now + TTL };
    await set(values); await prune();
  }
  async function settingsGet() {
    const value = (await get(`${PREFIX}settings`))[`${PREFIX}settings`] || {};
    return { glossary: Array.isArray(value.glossary) ? value.glossary : [], defaultGlossary: DEFAULT_TERMS };
  }
  async function settingsUpdate(settings) {
    const glossary = [...new Set((settings.glossary || []).map((x) => String(x).trim()).filter(Boolean))];
    if (glossary.length > 200 || new Blob([JSON.stringify(glossary)]).size > 8192) throw new Error("glossary_limit");
    await set({ [`${PREFIX}settings`]: { glossary } }); return settingsGet();
  }
  async function diagnostics() {
    const all = await get(null), keys = Object.keys(all), transcriptKeys = keys.filter((key) => key.startsWith(`${PREFIX}transcript:`));
    return { cacheCount: transcriptKeys.length, cacheBytes: new Blob([JSON.stringify(all)]).size, cacheLimit: LIMIT, cacheByteLimit: MAX_BYTES, metrics: all[`${PREFIX}metrics`] || {} };
  }
  async function metric(name, detail) {
    const key = `${PREFIX}metrics`, all = await get(key), value = all[key] || { days: {} }, day = new Date().toISOString().slice(0, 10);
    value.days[day] ||= {}; value.days[day][name] = (value.days[day][name] || 0) + 1;
    if (detail?.code) { value.days[day].failures ||= {}; value.days[day].failures[detail.code] = (value.days[day].failures[detail.code] || 0) + 1; }
    for (const old of Object.keys(value.days).sort().slice(0, -7)) delete value.days[old]; await set({ [key]: value });
  }
  async function clearCache() { const all = await get(null); await remove(Object.keys(all).filter((key) => key.startsWith(`${PREFIX}transcript:`) || key.startsWith(`${PREFIX}message:`))); }
  globalThis.WTStorage = { migrate, cacheGet, cacheSet, clear: clearCache, settingsGet, settingsUpdate, diagnostics, metric };
})();
