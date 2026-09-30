async page => {
  await page.addInitScript(() => {
    const settings = { glossary: ["Betinhos"], transcriptionMode: "balanced", autoTranscribe: false };
    const state = { settings, healthAvailable: true, cacheCount: 1 };
    globalThis.__WT_POPUP_FIXTURE__ = state;
    globalThis.confirm = () => true;
    globalThis.chrome.runtime = {
      lastError: null,
      sendMessage(message, callback) {
        if (message.type === "HEALTH_CHECK") {
          callback(state.healthAvailable
            ? { ok: true, health: { compatible: true, queue: { depth: 0, capacity: 3 }, model: { profile: "adaptável/int8" }, backend_version: "0.2.0" } }
            : { ok: false, error: { message: "Serviço indisponível" } });
        } else if (message.type === "DIAGNOSTICS_GET") {
          callback({ ok: true, diagnostics: { cacheCount: state.cacheCount, cacheBytes: 2048 } });
        } else if (message.type === "SETTINGS_GET") {
          callback({ ok: true, settings, extensionVersion: "0.2.0" });
        } else if (message.type === "SETTINGS_UPDATE") {
          Object.assign(settings, message.settings);
          callback({ ok: true, settings });
        } else if (message.type === "CACHE_CLEAR") {
          state.cacheCount = 0;
          callback({ ok: true });
        }
      },
    };
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#health-card").dataset.state === "ready");
  if (await page.locator("#cache-usage").textContent() !== "1 transcrição · 0.00 MB") throw new Error("Contagem do cache incorreta");
  await page.locator('input[value="precise"]').check();
  await page.waitForFunction(() => document.querySelector("#quality-saving").textContent === "Salvo");
  await page.locator(".automatic-hitarea").click();
  await page.waitForFunction(() => document.querySelector("#automatic-status").textContent.includes("ativada"));
  await page.locator("#glossary-toggle").click();
  await page.locator("#glossary").fill("Betinhos\nCongonhas");
  await page.locator("#save-glossary").click();
  await page.waitForFunction(() => document.querySelector("#glossary-status").textContent.includes("salvo"));
  await page.locator("#glossary").fill("rascunho não salvo");
  await page.locator("#cache-toggle").click();
  await page.locator("#clear-cache").click();
  await page.waitForFunction(() => document.querySelector("#cache-status").textContent.includes("limpas"));
  if (await page.locator("#glossary").inputValue() !== "rascunho não salvo") throw new Error("Limpar cache apagou o rascunho do glossário");
  await page.evaluate(() => { globalThis.__WT_POPUP_FIXTURE__.healthAvailable = false; });
  await page.locator("#retry").evaluate((button) => button.click());
  await page.waitForFunction(() => document.querySelector("#health-card").dataset.state === "error");
  if (await page.locator('input[name="quality-mode"]:checked').inputValue() !== "precise") throw new Error("Falha do serviço apagou ajuste local");
  await page.setViewportSize({ width: 360, height: 700 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Popup tem rolagem horizontal em 360 px");
  await page.locator("#quality-title").click();
  await page.keyboard.press("Tab");
  if (await page.evaluate(() => document.activeElement?.name) !== "quality-mode") throw new Error("Seleção de qualidade inacessível pelo teclado");
  await page.keyboard.press("ArrowLeft");
  if (await page.locator('input[name="quality-mode"]:checked').inputValue() !== "balanced") throw new Error("Seta não troca a qualidade");
  await page.keyboard.press("Tab");
  if (await page.evaluate(() => document.activeElement?.id) !== "automatic") throw new Error("Alternância automática fora da ordem de teclado");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("#automatic-status").textContent.includes("desativada"));
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Tema escuro tem rolagem horizontal");
  return "Popup: estado, ajustes, cache e rascunho preservado.";
}
