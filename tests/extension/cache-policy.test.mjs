import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../extension/cache-policy.js", import.meta.url), "utf8");
const context = { globalThis: {}, Date };
vm.runInNewContext(source, context);
const policy = context.globalThis.WTCachePolicy;

test("cache expira sete dias após createdAt", () => {
  const createdAt = 1_000_000;
  const record = { createdAt };
  assert.equal(policy.expiresAt(record), createdAt + policy.TTL_MS);
  assert.equal(policy.isFresh(record, createdAt + policy.TTL_MS - 1), true);
  assert.equal(policy.isFresh(record, createdAt + policy.TTL_MS), false);
});

test("expiresAt explícito é respeitado e registros sem data não são restaurados", () => {
  assert.equal(policy.expiresAt({ createdAt: 1, expiresAt: 900 }), 900);
  assert.equal(policy.isFresh({ text: "sem data" }, Date.now()), false);
});
