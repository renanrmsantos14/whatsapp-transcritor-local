(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const send = (message) => new Promise((resolve, reject) => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) return reject(new Error("Extensão não disponível neste navegador."));
    runtime.sendMessage(message, (response) => runtime.lastError || !response?.ok ? reject(new Error(runtime.lastError?.message || response?.error?.message || "Falha local")) : resolve(response));
  });
  const QUALITY = {
    fast: "Prioriza rapidez em áudios simples e falas claras.",
    balanced: "Boa velocidade sem abrir mão de muitos detalhes.",
    precise: "Analisa com mais cuidado e pode levar mais tempo.",
  };
  let lastDiagnostics = null, settingsLoaded = false, savedMode = "balanced", qualityTimer;

  function feedback(id, text, bad = false) { const target = $(id); target.textContent = text; target.hidden = !text; target.dataset.state = bad ? "error" : "success"; }
  function setBusy(button, busy) { button.disabled = busy; button.setAttribute("aria-busy", String(busy)); }
  function toggleSection(button) { const panel = $(button.getAttribute("aria-controls")); const expanded = button.getAttribute("aria-expanded") === "true"; if (expanded && panel.contains(document.activeElement)) button.focus(); button.setAttribute("aria-expanded", String(!expanded)); panel.hidden = expanded; }
  function normalizeGlossary(value) { return [...new Set(value.split(/\r?\n/).map((term) => term.trim()).filter(Boolean))]; }
  function showHealth(state, title, detail) { $("health-card").dataset.state = state; $("health-title").textContent = title; $("health-detail").textContent = detail; }
  function selectQuality(mode) { const radio = document.querySelector(`input[name="quality-mode"][value="${mode}"]`) || document.querySelector('input[value="balanced"]'); radio.checked = true; $("quality-help").textContent = QUALITY[mode] || QUALITY.balanced; }
  function showCacheUsage(diagnostics) { const count = diagnostics.cacheCount; $("cache-usage").textContent = `${count} ${count === 1 ? "transcrição" : "transcrições"} · ${(diagnostics.cacheBytes / 1048576).toFixed(2)} MB`; }

  async function refresh() {
    const retry = $("retry"); retry.hidden = true; feedback("feedback", ""); showHealth("checking", "Verificando serviço local", "Aguarde um instante.");
    const [healthResult, diagnosticsResult, settingsResult] = await Promise.allSettled([send({ type: "HEALTH_CHECK" }), send({ type: "DIAGNOSTICS_GET" }), send({ type: "SETTINGS_GET" })]);
    if (settingsResult.status === "fulfilled") {
      const { settings, extensionVersion } = settingsResult.value;
      if (!settingsLoaded) { $("glossary").value = settings.glossary.join("\n"); savedMode = settings.transcriptionMode; selectQuality(savedMode); $("automatic").checked = settings.autoTranscribe === true; settingsLoaded = true; }
      $("versions").textContent = `${extensionVersion} / —`;
      lastDiagnostics = { ...lastDiagnostics, extensionVersion };
    }
    if (diagnosticsResult.status === "fulfilled") {
      const { diagnostics } = diagnosticsResult.value;
      showCacheUsage(diagnostics);
      lastDiagnostics = { ...lastDiagnostics, diagnostics };
    }
    if (healthResult.status === "fulfilled") {
      const { health } = healthResult.value, compatible = health.compatible === true;
      const queueState = health.queue || { depth: health.queue_depth ?? 0, capacity: 3 };
      showHealth(compatible ? "ready" : "error", compatible ? "Pronto para transcrever" : "Versão incompatível", compatible ? "Abra uma conversa no WhatsApp Web e escolha Transcrever." : "Atualize o serviço local para continuar.");
      $("model").textContent = health.model?.profile || health.model || "small/int8"; $("queue").textContent = `${queueState.depth}/${queueState.capacity}`; $("versions").textContent = `${lastDiagnostics?.extensionVersion || "—"} / ${health.backend_version || "—"}`;
      lastDiagnostics = { ...lastDiagnostics, health };
      retry.hidden = compatible;
    } else {
      showHealth("error", "Serviço local indisponível", "Abra o Transcritor Local no Windows e tente novamente.");
      retry.hidden = false;
      if (healthResult.reason?.message?.includes("Extensão")) feedback("feedback", healthResult.reason.message, true);
    }
    $("copy-diagnostics").disabled = !lastDiagnostics;
  }

  $("retry").onclick = refresh;
  $("assistant-open").onclick = async () => {
    try { await send({ type: "ASSISTANT_PANEL" }); }
    catch (error) { feedback("feedback", error.message, true); }
  };
  for (const radio of document.querySelectorAll('input[name="quality-mode"]')) radio.onchange = async () => {
    if (!radio.checked) return;
    const mode = radio.value; selectQuality(mode); $("quality").disabled = true; clearTimeout(qualityTimer); $("quality-saving").textContent = "Salvando…";
    try { await send({ type: "SETTINGS_UPDATE", settings: { transcriptionMode: mode } }); savedMode = mode; $("quality-saving").textContent = "Salvo"; }
    catch (error) { selectQuality(savedMode); $("quality-saving").textContent = "Não salvo"; feedback("feedback", error.message, true); }
    finally { $("quality").disabled = false; qualityTimer = setTimeout(() => { $("quality-saving").textContent = ""; }, 1800); }
  };
  $("automatic").onchange = async () => {
    const toggle = $("automatic"), enabled = toggle.checked; toggle.disabled = true;
    try { await send({ type: "SETTINGS_UPDATE", settings: { autoTranscribe: enabled } }); feedback("automatic-status", enabled ? "Transcrição automática ativada." : "Transcrição automática desativada."); }
    catch (error) { toggle.checked = !enabled; feedback("automatic-status", error.message, true); }
    finally { toggle.disabled = false; }
  };
  for (const id of ["cache-toggle", "glossary-toggle", "diagnostics-toggle"]) $(id).onclick = () => toggleSection($(id));
  $("clear-cache").onclick = async () => {
    if (!window.confirm("Limpar todas as transcrições salvas neste computador?")) return;
    const button = $("clear-cache"); setBusy(button, true);
    try { await send({ type: "CACHE_CLEAR" }); feedback("cache-status", "Transcrições locais limpas."); $("cache-usage").textContent = "0 transcrições"; try { const { diagnostics } = await send({ type: "DIAGNOSTICS_GET" }); showCacheUsage(diagnostics); lastDiagnostics = { ...lastDiagnostics, diagnostics }; } catch (_) {} } catch (error) { feedback("cache-status", error.message, true); } finally { setBusy(button, false); }
  };
  $("save-glossary").onclick = async () => {
    const glossary = normalizeGlossary($("glossary").value);
    if (glossary.length > 200 || new Blob([JSON.stringify(glossary)]).size > 8192) { feedback("glossary-status", "Use até 200 termos e 8 KB.", true); return; }
    const button = $("save-glossary"); setBusy(button, true);
    try { await send({ type: "SETTINGS_UPDATE", settings: { glossary } }); $("glossary").value = glossary.join("\n"); feedback("glossary-status", "Glossário salvo neste computador."); } catch (error) { feedback("glossary-status", error.message, true); } finally { setBusy(button, false); }
  };
  $("copy-diagnostics").onclick = async () => {
    const button = $("copy-diagnostics"); setBusy(button, true);
    try { await navigator.clipboard.writeText(JSON.stringify(lastDiagnostics, null, 2)); feedback("diagnostics-status", "Relatório seguro copiado."); } catch (error) { feedback("diagnostics-status", error.message, true); } finally { setBusy(button, false); }
  };
  refresh();
})();
