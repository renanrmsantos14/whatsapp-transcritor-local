import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import test from "node:test";

const source = readFileSync(new URL("../extension/assistant-collector.js", import.meta.url), "utf8");
const context = vm.createContext({ document: { documentElement: { lang: "pt-BR" } } });
vm.runInContext(source, context);
const { chatId, timestamp } = context.WTAssistantCollector;

test("chat IDs stay separated; unknown IDs are not collected", () => {
  assert.equal(chatId("false_5511999999999@c.us_ABC"), "5511999999999@c.us");
  assert.equal(chatId("true_123456@g.us_ABC"), "123456@g.us");
  assert.equal(chatId("unknown"), null);
});
test("Portuguese timestamp is explicit; ambiguity stays missing", () => {
  assert.equal(timestamp("[10:30, 28/09/2026] Contato: ").sent_at, "2026-09-28T10:30:00-03:00");
  assert.equal(timestamp("[10:30, 28/09/2026] Contato: ").author, "Contato");
  assert.equal(timestamp("[10:30, 31/02/2026] Contato: ").missing, true);
  assert.equal(timestamp("[10:30, 09/28/2026] Contact: ", "en-US").missing, true);
});
test("collector has no WhatsApp action APIs or network interception", () => {
  assert.doesNotMatch(source, /\.click\s*\(|\.play\s*\(|scrollIntoView|scrollTo|CREATE_JOB|document\.cookie|indexedDB|XMLHttpRequest|fetch\s*\(/);
  const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  const collectorPath = background.slice(background.indexOf('case "ASSISTANT_INGEST"'), background.indexOf('case "HEALTH_CHECK"'));
  assert.doesNotMatch(collectorPath, /CREATE_JOB|\/jobs/);
  assert.match(collectorPath, /cacheGet/);
});

async function passiveRun(authorized, switchChat = false, exists = true, excluded = false, opaque = false, storage = false) {
  let scheduled, textReads = 0, currentId = "5511999999999@c.us";
  const sent = [], listeners = [];
  const makeElement = () => ({ style: {}, append() {}, setAttribute() {}, contains() { return false; }, addEventListener(type, callback) { listeners.push(callback); } });
  const row = { parentElement: null, hasAttribute() { return false; },
    getAttribute() { return opaque ? "a3b2c4d500998877" : `false_${currentId}_ABC`; },
    querySelector(selector) {
      if (selector === "[data-pre-plain-text]") return { getAttribute() { return "[10:30, 28/09/2026] Contato: "; } };
      return null;
    },
    querySelectorAll() { return [{ parentElement: null, closest() { return null; }, get textContent() { textReads++; return "Você aprova o orçamento?"; } }]; }
  };
  const main = {
    contains(node) { return node === row; },
    querySelectorAll(selector) { return selector === "[data-pre-plain-text]" ? [{ closest() { return row; } }] : [row]; },
    querySelector(selector) {
      if (opaque && selector === "header [title]") return null;
      return { getAttribute() { return opaque ? null : "Contato"; }, textContent: "Contato" };
    }
  };
  const sandbox = vm.createContext({
    crypto: webcrypto,
    document: { documentElement: { lang: "pt-BR" }, body: makeElement(), createElement: makeElement, querySelector() { return main; } },
    chrome: { ...(storage ? { storage: { local: { get: async () => { throw new Error("TRUSTED_CONTEXTS"); }, set: async () => {} } } } : {}), runtime: { sendMessage(message, callback) { sent.push(message); if (message.type === "ASSISTANT_PERMISSION") { if (switchChat) currentId = "5522888888888@c.us"; callback({ ok: true, permission: { collect: authorized, exists, excluded } }); } else callback({ ok: true, collect: true }); } } },
    MutationObserver: class { observe() {} }, setTimeout(callback) { scheduled = callback; return 1; }, clearTimeout() {}, setInterval() {}
  });
  vm.runInContext(source, sandbox);
  await new Promise(resolve => setImmediate(resolve));
  await scheduled();
  return { sent, textReads, listeners };
}

test("unauthorized conversations never have bodies extracted", async () => {
  const result = await passiveRun(false);
  assert.equal(result.textReads, 0);
  assert.deepEqual(result.sent.map((m) => m.type), ["ASSISTANT_BINDINGS_GET", "ASSISTANT_PERMISSION"]);
  assert.equal(result.sent.some((m) => m.type === "ASSISTANT_LOCAL_ENABLE"), false);
});
test("authorized collection includes authors and times without UI actions", async () => {
  const result = await passiveRun(true);
  const ingestion = result.sent.find((m) => m.type === "ASSISTANT_INGEST");
  assert.equal(ingestion.conversationId, "5511999999999@c.us");
  assert.equal(ingestion.messages[0].text, "Você aprova o orçamento?");
  assert.equal(ingestion.messages[0].author, "Contato");
  assert.equal(ingestion.messages[0].sent_at, "2026-09-28T10:30:00-03:00");
});
test("switching chat during consent check cannot mix conversations", async () => {
  const result = await passiveRun(true, true);
  assert.equal(result.textReads, 0);
  assert.equal(result.sent.some((m) => m.type === "ASSISTANT_INGEST"), false);
});

test("new conversations are collected automatically, locally", async () => {
  const result = await passiveRun(false, false, false);
  assert.equal(result.sent.find(m => m.type === "ASSISTANT_LOCAL_ENABLE").automatic, true);
  assert.equal(result.sent.some(m => m.type === "ASSISTANT_INGEST"), true);
});
test("excluded conversations are never automatically enabled", async () => {
  const result = await passiveRun(false, false, false, true);
  assert.equal(result.textReads, 0);
  assert.equal(result.sent.some(m => m.type === "ASSISTANT_LOCAL_ENABLE"), false);
});

test("opaque message IDs and header without title support automatic collection", async () => {
  const result = await passiveRun(false, false, false, false, true);
  const ingestion = result.sent.find(m => m.type === "ASSISTANT_INGEST");
  assert.ok(ingestion);
  assert.match(ingestion.conversationId, /^local:/);
  assert.equal(ingestion.messages[0].id, "a3b2c4d500998877");
  assert.equal(ingestion.messages[0].text, "Você aprova o orçamento?");
});

test("trusted-only storage is accessed through background, never content script", async () => {
  const result = await passiveRun(false, false, false, false, true, true);
  assert.ok(result.sent.find(m => m.type === "ASSISTANT_INGEST"));
});
