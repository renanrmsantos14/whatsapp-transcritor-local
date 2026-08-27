import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("protocolo v2 expõe somente mensagens públicas", () => {
  const context = { globalThis: {} }; vm.createContext(context); vm.runInContext(fs.readFileSync("extension/protocol.js", "utf8"), context);
  assert.equal(context.globalThis.WTProtocol.API_VERSION, 2);
  assert.equal(context.globalThis.WTProtocol.isKnown("CREATE_JOB"), true);
  assert.equal(context.globalThis.WTProtocol.isKnown("TRANSCRIBE_AUDIO"), false);
});

test("manifesto fixa versão, chave e storage", () => {
  const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
  assert.equal(manifest.version, "0.2.0"); assert.ok(manifest.key); assert.deepEqual(manifest.permissions, ["storage"]);
});
