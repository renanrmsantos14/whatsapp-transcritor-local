chrome.runtime.sendMessage({ type: "HEALTH_CHECK" }, (response) => {
  const status = document.getElementById("status");
  if (chrome.runtime.lastError || !response?.ok) {
    status.textContent = "Transcritor local indisponível. Execute scripts\\iniciar.bat.";
    return;
  }
  const health = response.health;
  status.textContent = health.ready ? `Backend pronto (${health.device}).\nAbra o WhatsApp Web.` : "Backend encontrado, mas modelo ainda não está pronto.";
});
