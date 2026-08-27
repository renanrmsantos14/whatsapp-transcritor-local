import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../extension/selectors.js", import.meta.url), "utf8");
const context = { globalThis: {}, document: {} };
vm.runInNewContext(source, context);
const selectors = context.globalThis.WTSelectors;

test("identifica direção pelo data-id sem classes frágeis", () => {
  const makeRow = (id) => ({
    querySelector: () => ({ getAttribute: () => id }),
    closest: () => null,
  });
  assert.equal(selectors.isOutgoing(makeRow("true_abc")), true);
  assert.equal(selectors.isOutgoing(makeRow("false_abc")), false);
});

test("identifica nota de voz por hints semânticos", () => {
  const row = { querySelector: (selector) => selector.includes("ptt-status") ? {} : null };
  assert.equal(selectors.isVoiceNote(row), true);
});

test("identifica áudio encaminhado por duração e controle de reprodução", () => {
  const row = {
    textContent: "Forwarded 1:32 15:39",
    querySelector: (selector) => selector.includes("audio") ? null : null,
    querySelectorAll: () => [{ getAttribute: (name) => name === "aria-label" ? "Reproduzir áudio" : "" }],
  };
  assert.equal(selectors.isVoiceNote(row), true);
});

test("manifesto mantém permissões mínimas e worker como ponte local", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../../extension/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.host_permissions, ["https://web.whatsapp.com/*", "http://127.0.0.1:8765/*"]);
  assert.equal(manifest.background.service_worker, "background.js");
  const background = fs.readFileSync(new URL("../../extension/background.js", import.meta.url), "utf8");
  assert.match(background, /const WT_API = "http:\/\/127\.0\.0\.1:8765"/);
  assert.match(background, /const setup = message\?\.type === "HEALTH_CHECK" && !sender\.tab/);
  assert.match(background, /audioBase64/);
  assert.doesNotMatch(background, /message\.url|fetch\(message/);
});
