import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../extension/page-hook.js", import.meta.url), "utf8");

function createHook({ debug = true } = {}) {
  const listeners = new Map();
  const messages = [];
  const logs = [];
  const urls = new Map();
  let nextUrl = 0;
  let scanCapture;
  const markedTarget = {
    messageId: "chat-a",
    isConnected: true,
    visible: true,
    getAttribute(name) { return name === "data-id" ? this.messageId : null; },
    getClientRects() { return this.visible ? [{}] : []; },
  };
  const markedRow = {
    media: [],
    isConnected: true,
    contains(node) { return node === markedTarget || this.media.includes(node); },
    querySelectorAll() { return this.media; },
  };
  const window = {
    Audio: class Audio {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    postMessage(message) { messages.push(message); },
  };
  class HTMLMediaElement {
    play() { this.plays = (this.plays || 0) + 1; this.paused = false; return Promise.resolve(); }
    pause() {}
  }
  class AudioBufferSourceNode {
    start() { this.starts = (this.starts || 0) + 1; }
  }
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    get() { return this._src || ""; },
    set(value) { this._src = value; },
  });
  const context = {
    __WT_TRANSCRITOR_DEBUG__: debug,
    Blob,
    Date,
    HTMLMediaElement,
    AudioBufferSourceNode,
    URL: { createObjectURL(blob) { const url = `blob:fixture-${++nextUrl}`; urls.set(url, blob); return url; } },
    console: { info(...args) { logs.push(args); }, group(...args) { logs.push(args); }, table(...args) { logs.push(args); }, groupEnd() {} },
    document: {
      querySelector(selector) {
        if (!selector.includes("marker-a")) return null;
        return selector.includes("wt-capture-target") ? markedTarget : markedRow;
      },
    },
    fetch: async (url) => ({ ok: true, blob: async () => urls.get(url) }),
    setInterval(callback) { scanCapture = callback; return 1; },
    clearInterval() {},
    window,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const request = (id, action, extra = {}) => listeners.get("message")({ source: window, data: { __wt: "request", id, action, ...extra } });
  return { context, markedRow, markedTarget, messages, logs, request, scan: () => scanCapture() };
}

test("hook captura createObjectURL global da mensagem marcada", async () => {
  const hook = createHook();
  const audioA = new Blob(["audio-a"], { type: "audio/ogg" });

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a" });
  hook.context.URL.createObjectURL(audioA);
  await new Promise((resolve) => setTimeout(resolve, 0));
  hook.request("capture", "capture");

  assert.equal(await hook.messages.find((message) => message.id === "capture")?.blob?.text(), "audio-a");
});

test("hook não associa blob B quando row marcada é reciclada", async () => {
  const hook = createHook();
  const audioB = new Blob(["audio-b"], { type: "audio/ogg" });

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a" });
  hook.markedTarget.messageId = "chat-b";
  const sourceB = hook.context.URL.createObjectURL(audioB);
  hook.markedRow.media = [{ currentSrc: sourceB, src: sourceB, getAttribute() { return sourceB; } }];
  hook.scan();
  await new Promise((resolve) => setTimeout(resolve, 0));
  hook.request("capture", "capture");

  assert.equal(hook.messages.find((message) => message.id === "capture"), undefined);
});

test("hook consome o único blob pré-arm mesmo sem owner observável", async () => {
  const hook = createHook();
  const audioA = new Blob(["audio-a"], { type: "audio/ogg" });

  hook.context.URL.createObjectURL(audioA);
  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", traceId: 43 });

  const prearm = hook.logs.find(([, event]) => event === "prearm_retained")?.[2];
  assert.deepEqual(JSON.parse(JSON.stringify(prearm)), { traceId: 43, retainedAudioCount: 1, sourceObservedCount: 0, exactOwnerCandidateCount: 0, ambiguousOwnerCandidateCount: 0 });
  hook.request("capture", "capture");
  assert.equal(await hook.messages.find((message) => message.id === "capture")?.blob?.text(), "audio-a");
  assert.doesNotMatch(JSON.stringify(hook.logs), /marker-a|chat-a|audio-a|fixture-1/);
});

test("hook não consome blobs pré-arm quando há múltiplos candidatos", () => {
  const hook = createHook();

  hook.context.URL.createObjectURL(new Blob(["audio-a"], { type: "audio/ogg" }));
  hook.context.URL.createObjectURL(new Blob(["audio-b"], { type: "audio/ogg" }));
  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", traceId: 44 });
  hook.request("capture", "capture");

  const prearm = hook.logs.find(([, event]) => event === "prearm_retained")?.[2];
  assert.deepEqual(JSON.parse(JSON.stringify(prearm)), { traceId: 44, retainedAudioCount: 2, sourceObservedCount: 0, exactOwnerCandidateCount: 0, ambiguousOwnerCandidateCount: 0 });
  assert.equal(hook.messages.find((message) => message.id === "capture"), undefined);
});

test("hook consome candidato pré-arm único com owner exato", async () => {
  const hook = createHook();
  const sourceA = hook.context.URL.createObjectURL(new Blob(["audio-a"], { type: "audio/ogg" }));
  const media = new hook.context.HTMLMediaElement();
  media.closest = (selector) => selector === "[data-id]" ? hook.markedTarget : null;
  media.src = sourceA;

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", traceId: 44 });

  const prearm = hook.logs.find(([, event]) => event === "prearm_retained")?.[2];
  assert.deepEqual(JSON.parse(JSON.stringify(prearm)), { traceId: 44, retainedAudioCount: 1, sourceObservedCount: 1, exactOwnerCandidateCount: 1, ambiguousOwnerCandidateCount: 0 });
  hook.request("capture", "capture");
  assert.equal(await hook.messages.find((message) => message.id === "capture")?.blob?.text(), "audio-a");
});

test("hook escolhe o owner exato entre múltiplos blobs pré-arm", async () => {
  const hook = createHook();
  const sourceA = hook.context.URL.createObjectURL(new Blob(["audio-a"], { type: "audio/ogg" }));
  hook.context.URL.createObjectURL(new Blob(["audio-b"], { type: "audio/ogg" }));
  const media = new hook.context.HTMLMediaElement();
  media.closest = (selector) => selector === "[data-id]" ? hook.markedTarget : null;
  media.src = sourceA;

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", traceId: 46 });
  hook.request("capture", "capture");

  assert.equal(await hook.messages.find((message) => message.id === "capture")?.blob?.text(), "audio-a");
});

test("hook suprime telemetria em produção", () => {
  const hook = createHook({ debug: false });
  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", traceId: 45 });

  assert.deepEqual(hook.logs, []);
});

test("hook registra limites sanitizados da captura", () => {
  const hook = createHook();

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", traceId: 42 });
  hook.context.URL.createObjectURL(new Blob(["audio-a"], { type: "audio/ogg" }));
  hook.request("capture", "capture");

  const events = hook.logs.map(([, event]) => event);
  for (const event of ["arm", "target_lookup", "ownership_check", "create_object_url", "capture_candidate", "capture_waiter"]) assert.ok(events.includes(event), `missing ${event}`);
  const diagnostic = JSON.stringify(hook.logs);
  assert.doesNotMatch(diagnostic, /marker-a|chat-a|audio-a/);
  assert.match(diagnostic, /"traceId":42/);
});

test("hook não interrompe Web Audio durante captura mutada", () => {
  const hook = createHook();
  const source = new hook.context.AudioBufferSourceNode();

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a" });
  source.start();
  assert.equal(source.starts, 1);

  hook.request("disarm", "disarm");
  source.start();
  assert.equal(source.starts, 2);
});

test("hook captura sem executar o play real quando o áudio está mutado", async () => {
  const hook = createHook();
  const media = new hook.context.HTMLMediaElement();
  media.muted = false; media.volume = 0.9; media.paused = true;

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", muteAudio: true });
  await media.play();

  assert.equal(media.plays || 0, 0);
  assert.equal(media.paused, true);
  assert.equal(media.muted, true);
  assert.equal(media.volume, 0);
});

test("play manual volta a funcionar imediatamente depois da captura", async () => {
  const hook = createHook();
  const media = new hook.context.HTMLMediaElement();
  media.muted = false; media.volume = 0.9; media.paused = true;

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", muteAudio: true });
  await media.play();
  hook.request("disarm", "disarm");
  assert.equal(media.muted, false);

  await media.play();
  assert.equal(media.plays, 1);
  assert.equal(media.muted, false);
  assert.equal(media.volume, 0.9);
});

test("hook permite Web Audio quando usuário desativa o mute", () => {
  const hook = createHook();
  const source = new hook.context.AudioBufferSourceNode();

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", muteAudio: false });
  source.start();

  assert.equal(source.starts, 1);
});

test("hook restaura volume e mute ao terminar a captura bloqueada", async () => {
  const hook = createHook();
  const media = new hook.context.HTMLMediaElement();
  media.muted = false; media.volume = 0.7;

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a" });
  await media.play();
  assert.equal(media.muted, true);
  assert.equal(media.volume, 0);

  hook.request("disarm", "disarm");
  assert.equal(media.muted, false);
  assert.equal(media.volume, 0.7);
});

test("hook aplica mudança de mute imediatamente durante a captura", async () => {
  const hook = createHook();
  const media = new hook.context.HTMLMediaElement();
  media.muted = false; media.volume = 0.6;

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a" });
  await media.play();
  assert.equal(media.muted, true);

  hook.request("sound-on", "set_mute", { muteAudio: false });
  assert.equal(media.muted, false);
  assert.equal(media.volume, 0.6);

  await media.play();
  assert.equal(media.plays, 1);
});

test("mute selecionado fora da captura não bloqueia o play manual", async () => {
  const hook = createHook();
  const media = new hook.context.HTMLMediaElement();
  media.muted = false; media.volume = 0.8;

  hook.request("arm", "arm", { marker: "marker-a", messageId: "chat-a", muteAudio: false });
  hook.request("disarm", "disarm");
  hook.request("mute-after", "set_mute", { muteAudio: true });
  await media.play();

  assert.equal(media.muted, false);
  assert.equal(media.volume, 0.8);
});

test("expõe comandos de debug e relatório no console", () => {
  const hook = createHook({ debug: false });

  hook.context.WTTranscritor.debug(true);
  hook.context.WTTranscritor.report();

  assert.equal(hook.context.__WT_TRANSCRITOR_DEBUG__, true);
  assert.ok(hook.logs.some((entry) => String(entry[0]).includes("Relatório da captura")));
  assert.ok(hook.messages.some((message) => message.__wt === "diagnostic_command" && message.action === "report"));
});
