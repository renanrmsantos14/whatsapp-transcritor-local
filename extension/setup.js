(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const send = (message) => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => chrome.runtime.lastError || !response?.ok ? reject(new Error(chrome.runtime.lastError?.message || response?.error?.message || "Falha local")) : resolve(response)));
  let lastDiagnostics = null;
  function feedback(text, bad = false) { $("feedback").textContent = text; $("feedback").style.color = bad ? "var(--danger)" : "var(--accent)"; }
  async function refresh() {
    try {
      const [{ health }, { diagnostics }, { settings, extensionVersion }] = await Promise.all([send({ type: "HEALTH_CHECK" }), send({ type: "DIAGNOSTICS_GET" }), send({ type: "SETTINGS_GET" })]);
      const queueState = health.queue || { depth: health.queue_depth ?? 0, capacity: 3 };
      $("health-card").dataset.state = health.compatible ? "ready" : "error"; $("health-title").textContent = health.compatible ? "Backend pronto" : "Versão incompatível"; $("health-detail").textContent = `API ${health.api_version} · ${health.device}`;
      $("versions").textContent = `${extensionVersion} / ${health.backend_version || "0.1.x"}`; $("model").textContent = health.model?.profile || health.model || "small/int8"; $("device").textContent = health.device || "cpu"; $("queue").textContent = `${queueState.depth}/${queueState.capacity}`;
      $("cache-usage").textContent = `${diagnostics.cacheCount}/500 · ${(diagnostics.cacheBytes / 1048576).toFixed(2)} MB`; $("glossary").value = settings.glossary.join("\n"); lastDiagnostics = { health, diagnostics, extensionVersion };
    } catch (error) { $("health-card").dataset.state = "error"; $("health-title").textContent = "Backend indisponível"; $("health-detail").textContent = "Inicie o serviço local e teste novamente."; feedback(error.message, true); }
  }
  $("retry").onclick = refresh;
  $("clear-cache").onclick = async () => { await send({ type: "CACHE_CLEAR" }); feedback("Cache limpo."); refresh(); };
  $("save-glossary").onclick = async () => { try { await send({ type: "SETTINGS_UPDATE", settings: { glossary: $("glossary").value.split(/\r?\n/) } }); feedback("Glossário salvo."); } catch (error) { feedback(error.message, true); } };
  $("copy-diagnostics").onclick = async () => { await navigator.clipboard.writeText(JSON.stringify(lastDiagnostics, null, 2)); feedback("Relatório copiado."); };
  const copy = async (value, message) => { await navigator.clipboard.writeText(value); feedback(message); };
  $("install").onclick = () => copy("powershell -File scripts\\instalar.ps1", "Comando copiado."); $("start").onclick = () => copy("scripts\\iniciar.bat", "Comando copiado."); $("reload").onclick = () => copy("Ctrl+Shift+R", "Atalho copiado."); $("extension-path").onclick = () => copy("extension", "Caminho relativo copiado.");
  refresh();
})();
