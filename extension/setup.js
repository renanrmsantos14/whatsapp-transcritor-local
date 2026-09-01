(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const send = (message) => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => chrome.runtime.lastError || !response?.ok ? reject(new Error(chrome.runtime.lastError?.message || response?.error?.message || "Falha local")) : resolve(response)));
  let lastDiagnostics = null;

  function feedback(text, bad = false) { $("feedback").textContent = text; $("feedback").style.color = bad ? "var(--danger)" : "var(--accent-strong)"; }
  function setBusy(button, busy) { button.disabled = busy; button.setAttribute("aria-busy", String(busy)); }
  function toggleSection(button) { const panel = $(button.getAttribute("aria-controls")); const expanded = button.getAttribute("aria-expanded") === "true"; button.setAttribute("aria-expanded", String(!expanded)); panel.hidden = expanded; }
  function normalizeGlossary(value) { return [...new Set(value.split(/\r?\n/).map((term) => term.trim()).filter(Boolean))]; }
  function showHealth(state, title, detail) { $("health-card").dataset.state = state; $("health-title").textContent = title; $("health-detail").textContent = detail; }

  async function refresh() {
    const retry = $("retry"); retry.hidden = true; showHealth("checking", "Verificando serviço local", "Aguarde um instante.");
    try {
      const [{ health }, { diagnostics }, { settings, extensionVersion }] = await Promise.all([send({ type: "HEALTH_CHECK" }), send({ type: "DIAGNOSTICS_GET" }), send({ type: "SETTINGS_GET" })]);
      const queueState = health.queue || { depth: health.queue_depth ?? 0, capacity: 3 };
      const compatible = health.compatible === true;
      showHealth(compatible ? "ready" : "error", compatible ? "Serviço local pronto" : "Versão incompatível", `API ${health.api_version || "—"} · ${health.device || "CPU"}`);
      $("model").textContent = health.model?.profile || health.model || "small/int8"; $("queue").textContent = `${queueState.depth}/${queueState.capacity}`; $("versions").textContent = `${extensionVersion} / ${health.backend_version || "0.1.x"}`;
      $("cache-usage").textContent = `${diagnostics.cacheCount}/500 · ${(diagnostics.cacheBytes / 1048576).toFixed(2)} MB`; $("glossary").value = settings.glossary.join("\n"); lastDiagnostics = { health, diagnostics, extensionVersion };
      retry.hidden = compatible;
      if (!compatible) feedback("Atualize o serviço local para continuar.", true);
    } catch (error) { showHealth("error", "Serviço local indisponível", "Inicie o backend local e tente novamente."); retry.hidden = false; feedback(error.message, true); }
  }

  $("retry").onclick = refresh;
  for (const id of ["cache-toggle", "glossary-toggle", "diagnostics-toggle"]) $(id).onclick = () => toggleSection($(id));
  $("clear-cache").onclick = async () => {
    if (!window.confirm("Limpar todas as transcrições salvas neste computador?")) return;
    const button = $("clear-cache"); setBusy(button, true);
    try { await send({ type: "CACHE_CLEAR" }); feedback("Transcrições locais limpas."); await refresh(); } catch (error) { feedback(error.message, true); } finally { setBusy(button, false); }
  };
  $("save-glossary").onclick = async () => {
    const glossary = normalizeGlossary($("glossary").value);
    if (glossary.length > 200 || new Blob([JSON.stringify(glossary)]).size > 8192) { feedback("Use até 200 termos e 8 KB.", true); return; }
    const button = $("save-glossary"); setBusy(button, true);
    try { await send({ type: "SETTINGS_UPDATE", settings: { glossary } }); $("glossary").value = glossary.join("\n"); feedback("Glossário salvo neste computador."); } catch (error) { feedback(error.message, true); } finally { setBusy(button, false); }
  };
  $("copy-diagnostics").onclick = async () => {
    const button = $("copy-diagnostics"); setBusy(button, true);
    try { await navigator.clipboard.writeText(JSON.stringify(lastDiagnostics, null, 2)); feedback("Relatório seguro copiado."); } catch (error) { feedback(error.message, true); } finally { setBusy(button, false); }
  };
  refresh();
})();
