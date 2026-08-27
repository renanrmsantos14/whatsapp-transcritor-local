chrome.runtime.sendMessage({ type: "HEALTH_CHECK" }, (response) => {
  const status = document.getElementById("status");
  if (chrome.runtime.lastError || !response?.ok) {
    console.warn("[WT setup] health_check_error", response?.error || chrome.runtime.lastError?.message || "sem resposta");
    status.textContent = "Transcritor local indisponível. Execute scripts\\iniciar.bat.";
    return;
  }
  const health = response.health;
  console.info("[WT setup] health_check_ok", { ready: health.ready, device: health.device, queueDepth: health.queue_depth });
  status.textContent = health.ready ? `Backend pronto (${health.device}).\nAbra o WhatsApp Web.` : "Backend encontrado, mas modelo ainda não está pronto.";
});
