import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../extension/content.js", import.meta.url), "utf8");

test("protege restore quando runtime da extensão foi invalidado", () => {
  assert.match(source, /globalThis\.chrome\?\.runtime/);
});

test("suprime telemetria de conteúdo sem flag explícita", () => {
  assert.match(source, /if \(globalThis\.__WT_TRANSCRITOR_DEBUG__ === true\) console\.info/);
  assert.match(source, /diagnostic_command/);
});

test("modo automático limita-se a recebidos e serializa capturas", () => {
  assert.match(source, /!autoTranscribe \|\| S\.isOutgoing\(row\) \|\| S\.isUnplayedVoice\(row\) !== true/);
  assert.match(source, /captureChain\.then\(\(\) => tracked\.canceled \? null : capture\(row, ui\)\)/);
  assert.doesNotMatch(source, /runChain/);
  assert.match(source, /autoAttempted\.has\(messageId\)/);
  assert.match(source, /ui\.restoring/);
  assert.match(source, /SETTINGS_GET/);
});

test("refazer exibe botão próprio e ignora o cache", () => {
  assert.match(source, /button class="wt-retry" type="button" hidden>Refazer<\/button>/);
  assert.match(source, /if \(!ignoreCache\)/);
  assert.match(source, /queueRun\(row, ui, false, true\)/);
});

function createContent({ runtimeAvailable = true } = {}) {
  let rescan;
  const cache = new Map([["chat-b", { text: "texto-b" }]]);
  const control = () => ({ dataset: {}, style: {}, hidden: false, textContent: "" });
  const document = {
    body: {},
    createElement() {
      const host = {
        dataset: {},
        isConnected: false,
        addEventListener() {},
        remove() { this.isConnected = false; },
        scrollIntoView() {},
        attachShadow() {
          const controls = new Map([
            [".wt-wrap", control()], [".wt-status", control()], [".wt-result", control()],
            [".wt-action", control()], [".wt-sound", { ...control(), setAttribute() {} }], [".wt-cancel", control()], [".wt-copy", control()], [".wt-retry", control()],
          ]);
          return { set innerHTML(_) {}, querySelector(selector) { return controls.get(selector); } };
        },
      };
      return host;
    },
  };
  const row = {
    id: "chat-b",
    isConnected: true,
    getBoundingClientRect() { return { width: 0 }; },
    append(host) { host.isConnected = true; this.host = host; },
  };
  const selectors = {
    rows: () => [row],
    messageId: (node) => node.id,
    isOutgoing: () => false,
    bubbleAnchor: () => null,
    isLastMessage: () => false,
  };
  const context = {
    WTSelectors: selectors,
    MutationObserver: class { constructor(callback) { rescan = callback; } observe() {} },
    chrome: runtimeAvailable ? { runtime: { lastError: null, sendMessage(message, callback) { callback({ ok: true, cached: cache.get(message.messageId) || null }); } } } : { runtime: undefined },
    crypto: { subtle: {}, randomUUID: () => "fixture" },
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener() {},
    removeEventListener() {},
    postMessage() {},
    requestAnimationFrame(callback) { callback(); },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { row, rescan };
}

test("mantém UI pronta quando extensão recarregada invalida runtime", async () => {
  const fixture = createContent({ runtimeAvailable: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fixture.row.host.dataset.state, "Pronto");
});

test("recria controle quando row virtualizado recebe outra mensagem", async () => {
  const fixture = createContent();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const controlB = fixture.row.host;
  assert.equal(controlB.dataset.state, "Transcrição");

  fixture.row.id = "chat-a";
  fixture.rescan();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.notEqual(fixture.row.host, controlB);
  assert.equal(fixture.row.host.dataset.state, "Pronto");
});

function createCaptureContent({ captureOnDownload = true } = {}) {
  const listeners = new Set();
  let captureRequestId = null;
  let downloaded = false;
  let playClicks = 0;
  let silenceRequests = 0;
  let action = null;
  let retry = null;
  const runtimeMessages = [];
  const windowObject = {};
  const control = () => ({ dataset: {}, style: {}, hidden: false, textContent: "" });
  const respond = (context, id, payload) => {
    for (const listener of [...listeners]) listener({ source: windowObject, data: { __wt: "response", id, ...payload } });
  };
  const downloadButton = {
    textContent: "Baixar",
    getAttribute: () => "Baixar",
    dispatchEvent() {},
    click() {
      downloaded = true;
      if (captureOnDownload && captureRequestId) respond(context, captureRequestId, { ok: true, blob: new Blob(["audio-a"], { type: "audio/ogg" }) });
    },
  };
  const playButton = {
    textContent: "Reproduzir áudio",
    getAttribute: () => "Reproduzir áudio",
    dispatchEvent() {},
    click() {
      playClicks += 1;
      if (captureRequestId) respond(context, captureRequestId, { ok: true, blob: new Blob(["audio-a"], { type: "audio/ogg" }) });
    },
  };
  const document = {
    body: {},
    createElement() {
      const host = {
        dataset: {},
        isConnected: false,
        addEventListener() {},
        remove() {},
        scrollIntoView() {},
        attachShadow() {
          const controls = new Map([
            [".wt-wrap", control()], [".wt-status", control()], [".wt-result", control()],
            [".wt-action", control()], [".wt-sound", { ...control(), setAttribute() {} }], [".wt-cancel", control()], [".wt-copy", control()], [".wt-retry", control()],
          ]);
          action = controls.get(".wt-action");
          retry = controls.get(".wt-retry");
          return { set innerHTML(_) {}, querySelector(selector) { return controls.get(selector); } };
        },
      };
      return host;
    },
  };
  const row = {
    id: "chat-a",
    dataset: {},
    isConnected: true,
    contains: (node) => node === row,
    getBoundingClientRect: () => ({ width: 0 }),
    append(host) { host.isConnected = true; },
  };
  const selectors = {
    rows: () => [row],
    messageNode: () => row,
    messageId: () => row.id,
    transportButton: () => downloaded ? playButton : downloadButton,
    isDownloadButton: (button) => button === downloadButton,
    isOutgoing: () => false,
    bubbleAnchor: () => null,
    isLastMessage: () => false,
  };
  const context = {
    WTSelectors: selectors,
    Blob,
    MutationObserver: class { observe() {} },
    chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      runtimeMessages.push(message);
      if (message.type === "CREATE_JOB") return callback({ ok: true, job: { job_id: "job-1" } });
      if (message.type === "GET_JOB") return callback({ ok: true, job: { state: "completed", result: { text: "transcrição nova" } } });
      callback({ ok: true, cached: null });
    } } },
    crypto: { subtle: webcrypto.subtle, randomUUID: (() => { let id = 0; return () => `fixture-${++id}`; })() },
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
    postMessage(message) {
      if (message.action === "capture") { captureRequestId = message.id; return; }
      if (message.action === "silence") silenceRequests += 1;
      queueMicrotask(() => respond(context, message.id, { ok: true }));
    },
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback, delay) { if (delay === 5000) queueMicrotask(callback); return 0; },
    clearTimeout() {},
    btoa,
  };
  context.window = windowObject;
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    clickAction: () => action.onclick(),
    clickRetry: () => retry.onclick(),
    retry: () => retry,
    runtimeMessages: () => runtimeMessages,
    downloaded: () => downloaded,
    captureRequested: () => Boolean(captureRequestId),
    playClicks: () => playClicks,
    silenceRequests: () => silenceRequests,
  };
}

test("prepara o download e usa a reprodução como caminho principal", async () => {
  const fixture = createCaptureContent();

  assert.equal(fixture.downloaded(), false);
  assert.equal(fixture.playClicks(), 0);
  fixture.clickAction();
  for (let index = 0; index < 8; index += 1) await new Promise(setImmediate);

  assert.equal(fixture.downloaded(), true);
  assert.equal(fixture.captureRequested(), true);
  assert.equal(fixture.playClicks(), 1);
});

test("captura pela reprodução mesmo quando o download não expõe o blob", async () => {
  const fixture = createCaptureContent({ captureOnDownload: false });
  fixture.clickAction();
  for (let index = 0; index < 12; index += 1) await new Promise(setImmediate);

  assert.equal(fixture.playClicks(), 1);
  assert.equal(fixture.silenceRequests(), 1);
});

test("refazer captura e cria novo job sem consultar CACHE_GET", async () => {
  const fixture = createCaptureContent();
  fixture.clickAction();
  for (let index = 0; index < 12; index += 1) await new Promise(setImmediate);

  assert.equal(fixture.retry().hidden, false);
  const cacheReadsBefore = fixture.runtimeMessages().filter(({ type }) => type === "CACHE_GET").length;
  const jobsBefore = fixture.runtimeMessages().filter(({ type }) => type === "CREATE_JOB").length;

  fixture.clickRetry();
  for (let index = 0; index < 12; index += 1) await new Promise(setImmediate);

  assert.equal(fixture.runtimeMessages().filter(({ type }) => type === "CACHE_GET").length, cacheReadsBefore);
  assert.equal(fixture.runtimeMessages().filter(({ type }) => type === "CREATE_JOB").length, jobsBefore + 1);
  assert.equal(fixture.retry().hidden, false);
});
