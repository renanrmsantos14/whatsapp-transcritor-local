import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../extension/storage.js", import.meta.url), "utf8");

function createStorage() {
  const values = {};
  const local = {
    async get(keys) {
      if (keys === null) return { ...values };
      if (typeof keys === "string") return { [keys]: values[keys] };
      return Object.fromEntries(keys.map((key) => [key, values[key]]));
    },
    async set(writes) { Object.assign(values, writes); },
    async remove(keys) { for (const key of keys) delete values[key]; },
  };
  const context = {
    Blob,
    Date,
    TextEncoder,
    chrome: { storage: { local } },
    crypto: { subtle: { async digest(_, input) { return new Uint8Array(input).buffer; } } },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { storage: context.WTStorage, values };
}

test("não restaura ponteiro v2 sem prova de vínculo da mensagem", async () => {
  const fixture = createStorage();
  await fixture.storage.cacheSet("chat-a", "hash-a", { text: "texto-a" });
  const pointerKey = Object.keys(fixture.values).find((key) => key.startsWith("wt:v2:message:"));
  fixture.values[pointerKey] = { audioHash: "hash-b", expiresAt: Date.now() + 60_000 };
  fixture.values["wt:v2:transcript:hash-b"] = { text: "texto-b", expiresAt: Date.now() + 60_000 };

  assert.equal(await fixture.storage.cacheGet("chat-a"), null);
});

test("restaura ponteiro criado pela versão atual", async () => {
  const fixture = createStorage();
  await fixture.storage.cacheSet("chat-a", "hash-a", { text: "texto-a" });

  assert.equal((await fixture.storage.cacheGet("chat-a"))?.text, "texto-a");
});

test("salva velocidade e glossário sem uma escolha apagar a outra", async () => {
  const fixture = createStorage();
  await fixture.storage.settingsUpdate({ glossary: ["Betinhos VIP"] });
  await fixture.storage.settingsUpdate({ transcriptionMode: "fast" });

  const settings = await fixture.storage.settingsGet();
  assert.deepEqual([...settings.glossary], ["Betinhos VIP"]);
  assert.equal(settings.transcriptionMode, "fast");
  assert.equal(settings.autoTranscribe, false);
  assert.equal(settings.muteAudio, true);
});

test("salva transcrição automática sem apagar outras preferências", async () => {
  const fixture = createStorage();
  await fixture.storage.settingsUpdate({ glossary: ["Cliente XPTO"], transcriptionMode: "precise" });
  await fixture.storage.settingsUpdate({ autoTranscribe: true });

  const settings = await fixture.storage.settingsGet();
  assert.equal(settings.autoTranscribe, true);
  assert.equal(settings.transcriptionMode, "precise");
  assert.deepEqual([...settings.glossary], ["Cliente XPTO"]);
});

test("salva preferência de som sem apagar outras configurações", async () => {
  const fixture = createStorage();
  await fixture.storage.settingsUpdate({ glossary: ["Cliente XPTO"], autoTranscribe: true });
  await fixture.storage.settingsUpdate({ muteAudio: false });

  const settings = await fixture.storage.settingsGet();
  assert.equal(settings.muteAudio, false);
  assert.equal(settings.autoTranscribe, true);
  assert.deepEqual([...settings.glossary], ["Cliente XPTO"]);
});
