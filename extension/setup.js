(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const send = (message) => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => chrome.runtime.lastError || !response?.ok ? reject(new Error(chrome.runtime.lastError?.message || response?.error?.message || "Falha local")) : resolve(response)));
  const QUALITY = {
    1: { mode: "fast", label: "Mais rápido", help: "Prioriza rapidez em áudios simples e falas claras." },
    2: { mode: "balanced", label: "Equilibrado", help: "Boa velocidade sem abrir mão de muitos detalhes." },
    3: { mode: "precise", label: "Mais preciso", help: "Analisa com mais cuidado e pode levar mais tempo." },
  };
  let lastDiagnostics = null;

  function feedback(text, bad = false) { $("feedback").textContent = text; $("feedback").style.color = bad ? "var(--danger)" : "var(--accent-strong)"; }
  function setBusy(button, busy) { button.disabled = busy; button.setAttribute("aria-busy", String(busy)); }
  function toggleSection(button) { const panel = $(button.getAttribute("aria-controls")); const expanded = button.getAttribute("aria-expanded") === "true"; button.setAttribute("aria-expanded", String(!expanded)); panel.hidden = expanded; }
  function normalizeGlossary(value) { return [...new Set(value.split(/\r?\n/).map((term) => term.trim()).filter(Boolean))]; }
  function showHealth(state, title, detail) { $("health-card").dataset.state = state; $("health-title").textContent = title; $("health-detail").textContent = detail; }
  function qualityValue(mode) { return String(Object.entries(QUALITY).find(([, item]) => item.mode === mode)?.[0] || 2); }
  function showQuality(value) { const choice = QUALITY[value] || QUALITY[2]; $("quality-choice").textContent = choice.label; $("quality-help").textContent = choice.help; }

  async function refresh() {
    const retry = $("retry"); retry.hidden = true; showHealth("checking", "Verificando serviço local", "Aguarde um instante.");
    try {
      const [{ health }, { diagnostics }, { settings, extensionVersion }] = await Promise.all([send({ type: "HEALTH_CHECK" }), send({ type: "DIAGNOSTICS_GET" }), send({ type: "SETTINGS_GET" })]);
      const queueState = health.queue || { depth: health.queue_depth ?? 0, capacity: 3 };
      const compatible = health.compatible === true;
      showHealth(compatible ? "ready" : "error", compatible ? "Serviço local pronto" : "Versão incompatível", `API ${health.api_version || "—"} · ${health.device || "CPU"}`);
      $("model").textContent = health.model?.profile || health.model || "small/int8"; $("queue").textContent = `${queueState.depth}/${queueState.capacity}`; $("versions").textContent = `${extensionVersion} / ${health.backend_version || "0.1.x"}`;
      $("cache-usage").textContent = `${diagnostics.cacheCount}/500 · ${(diagnostics.cacheBytes / 1048576).toFixed(2)} MB`; $("glossary").value = settings.glossary.join("\n"); $("quality").value = qualityValue(settings.transcriptionMode); showQuality($("quality").value); $("automatic").checked = settings.autoTranscribe === true; lastDiagnostics = { health, diagnostics, extensionVersion };
      retry.hidden = compatible;
      if (!compatible) feedback("Atualize o serviço local para continuar.", true);
    } catch (error) { showHealth("error", "Serviço local indisponível", "Inicie o backend local e tente novamente."); retry.hidden = false; feedback(error.message, true); }
  }

  $("retry").onclick = refresh;
  $("quality").oninput = () => showQuality($("quality").value);
  $("quality").onchange = async () => {
    const range = $("quality"), choice = QUALITY[range.value] || QUALITY[2]; range.disabled = true; $("quality-saving").textContent = "Salvando…";
    try { await send({ type: "SETTINGS_UPDATE", settings: { transcriptionMode: choice.mode } }); $("quality-saving").textContent = "Salvo"; }
    catch (error) { feedback(error.message, true); await refresh(); }
    finally { range.disabled = false; setTimeout(() => { $("quality-saving").textContent = ""; }, 1200); }
  };
  $("automatic").onchange = async () => {
    const toggle = $("automatic"), enabled = toggle.checked; toggle.disabled = true;
    try { await send({ type: "SETTINGS_UPDATE", settings: { autoTranscribe: enabled } }); feedback(enabled ? "Transcrição automática ativada." : "Transcrição automática desativada."); }
    catch (error) { toggle.checked = !enabled; feedback(error.message, true); }
    finally { toggle.disabled = false; }
  };
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
