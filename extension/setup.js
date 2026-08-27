(function () {
  "use strict";
  const config = globalThis.LOCAL_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const healthCard = $("health-card");
  const healthTitle = $("health-title");
  const healthDetail = $("health-detail");
  const model = $("model");
  const device = $("device");
  const queue = $("queue");
  const feedback = $("feedback");

  function setFeedback(message, error = false) {
    feedback.textContent = message;
    feedback.style.color = error ? "var(--danger)" : "var(--accent)";
    if (message) window.setTimeout(() => { if (feedback.textContent === message) feedback.textContent = ""; }, 4500);
  }
  function sendHealth() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "HEALTH_CHECK" }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) { reject(new Error(runtimeError.message)); return; }
        if (!response?.ok) { reject(new Error(response?.error || "Backend indisponível")); return; }
        resolve(response.health);
      });
    });
  }
  function renderHealth(health) {
    const ready = Boolean(health?.ready);
    healthCard.dataset.state = ready ? "ready" : "error";
    healthTitle.textContent = ready ? "Backend pronto" : "Modelo ainda não está pronto";
    healthDetail.textContent = ready ? "Pode abrir o WhatsApp Web." : "Execute instalar ou atualizar para preparar o modelo.";
    model.textContent = health?.model || "small";
    device.textContent = health?.device || "cpu";
    queue.textContent = String(health?.queue_depth ?? 0);
    console.info("[WT setup] health_check_ok", { ready, device: health?.device, queueDepth: health?.queue_depth });
  }
  function renderError(error) {
    healthCard.dataset.state = "error";
    healthTitle.textContent = "Backend indisponível";
    healthDetail.textContent = "Inicie o serviço local e teste novamente.";
    model.textContent = "—"; device.textContent = "—"; queue.textContent = "—";
    console.warn("[WT setup] health_check_error", error.message);
  }
  async function refresh() {
    healthCard.dataset.state = "checking";
    healthTitle.textContent = "Verificando backend";
    healthDetail.textContent = "Aguarde um instante.";
    try { renderHealth(await sendHealth()); } catch (error) { renderError(error); }
  }
  async function copy(value, successMessage) {
    try { await navigator.clipboard.writeText(value); setFeedback(successMessage); console.info("[WT setup] clipboard_copy", { action: successMessage }); }
    catch (error) { setFeedback("Não foi possível copiar. Abra a pasta do projeto manualmente.", true); console.warn("[WT setup] clipboard_error", error.message); }
  }
  function rootPath() { return typeof config.projectRoot === "string" && config.projectRoot ? config.projectRoot : ""; }
  function scriptPath(name) { return rootPath() ? `${rootPath()}\\scripts\\${name}` : `scripts\\${name}`; }
  $("retry").addEventListener("click", refresh);
  $("install").addEventListener("click", () => copy(`& "${scriptPath("instalar.bat")}"`, "Comando de instalação copiado."));
  $("start").addEventListener("click", () => copy(`& "${scriptPath("iniciar.bat")}"`, "Comando para iniciar o backend copiado."));
  $("reload").addEventListener("click", () => copy("Ctrl+Shift+R", "Atalho de recarga copiado. Use-o na aba do WhatsApp Web."));
  $("extension-path").addEventListener("click", () => copy(config.extensionPath || "extension", "Caminho da extensão copiado."));
  refresh();
})();
