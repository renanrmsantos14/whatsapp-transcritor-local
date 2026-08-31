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
