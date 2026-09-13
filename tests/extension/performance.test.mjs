import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const content = fs.readFileSync(new URL("../../extension/content.js", import.meta.url), "utf8");
const hook = fs.readFileSync(new URL("../../extension/page-hook.js", import.meta.url), "utf8");

test("agrupa mutações e evita varredura completa em cada alteração", () => {
  assert.match(content, /let scanScheduled = false, fullScanPending = false/);
  assert.match(content, /const pendingRoots = new Set\(\)/);
  assert.match(content, /S\.rowForNode\(target\)/);
  assert.doesNotMatch(content, /MutationObserver\(\(\) => requestAnimationFrame\(scan\)\)/);
});

test("limita o fallback de captura a quatro verificações por segundo", () => {
  assert.match(hook, /setInterval\(scanCapture, 250\)/);
});

test("compartilha CSS e evita botões duplicados por estado", () => {
  assert.match(content, /const SHARED_SHEET =/);
  assert.match(content, /root\.adoptedStyleSheets = \[SHARED_SHEET\]/);
  assert.match(content, /<button class="wt-action" type="button"><\/button>/);
  assert.match(content, /<button class="wt-retry" type="button" hidden>Refazer<\/button>/);
  assert.match(content, /<button class="wt-sound" type="button"><\/button>/);
  assert.doesNotMatch(content, /<button class="wt-(?:cancel|copy)"/);
});

test("captura principal bloqueia a reprodução real quando está mutada", () => {
  assert.doesNotMatch(content, /Obtendo o áudio do WhatsApp/);
  assert.match(content, /if \(captureMuted\) await askPage\("hold"[\s\S]*?playButton\.click\(\);\s*if \(captureMuted\) await askPage\("silence"/);
  assert.match(hook, /if \(suppressing\(\)\) \{\s*silenceNode\(this\);\s*return Promise\.resolve\(\);\s*\}\s*restoreNode\(this\);\s*return originalPlay\.apply\(this, arguments\)/);
});
