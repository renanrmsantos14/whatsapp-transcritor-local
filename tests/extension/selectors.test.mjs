import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../extension/selectors.js", import.meta.url), "utf8");
const context = { globalThis: {}, document: {}, getComputedStyle: (node) => node.visualStyle || { backgroundColor: "transparent", borderTopLeftRadius: "0px" } };
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

test("usa o primeiro ancestral com geometria de bolha de áudio", () => {
  const row = { getBoundingClientRect: () => ({ width: 800 }) };
  const outer = { parentElement: row, getBoundingClientRect: () => ({ width: 410, height: 150 }), visualStyle: { backgroundColor: "rgb(255, 255, 255)", borderTopLeftRadius: "8px" } };
  const bubble = { parentElement: outer, getBoundingClientRect: () => ({ width: 350, height: 120 }), visualStyle: { backgroundColor: "rgb(255, 255, 255)", borderTopLeftRadius: "8px" } };
  const controls = { parentElement: bubble, getBoundingClientRect: () => ({ width: 320, height: 45 }), visualStyle: { backgroundColor: "transparent", borderTopLeftRadius: "0px" } };
  const media = { parentElement: controls };
  row.querySelector = (selector) => selector.includes("ptt-status") ? media : null;
  row.closest = () => null;
  assert.equal(selectors.bubbleAnchor(row), bubble);
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
  assert.match(background, /if \(!sender\.tab\) return true/);
  assert.match(background, /setAccessLevel/);
  assert.match(background, /audioBase64/);
  assert.doesNotMatch(background, /message\.url|fetch\(message/);
});
