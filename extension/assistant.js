(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const priorities = ["Ver agora", "Responder hoje", "Acompanhar", "Informativo", "Revisar"];
  const statuses = { disabled: "Análise pausada", collecting: "Somente coleta local", approval_required: "Novos trechos aguardam aprovação", queued: "Consultando Jev…", ready: "Análise disponível", error: "Falha na análise; resultado desatualizado" };
  let selected = null, state = null, previewHash = null, previewId = null, busy = false, detailStamp = "", listStamp = "", rulesDirty = false, detailDirty = false;
  $("rules").addEventListener("input", () => { rulesDirty = true; });
  $("detail").addEventListener("input", () => { detailDirty = true; });
  const ticket = decodeURIComponent(location.hash.slice(1));
  history.replaceState(null, "", location.pathname); // Do not retain the one-use ticket in browser history.
  function feedback(text, bad = false) { $("feedback").textContent = text; $("feedback").className = bad ? "danger" : ""; }
  async function api(path, method = "GET", body) {
    const response = await fetch(`/assistant/api${path}`, { method, credentials: "same-origin", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message || value.detail || "Falha no serviço local.");
    return value;
  }
  function node(tag, text, cls = "") { const item = document.createElement(tag); item.textContent = text; item.className = cls; return item; }
  function button(text, action) { const item = node("button", text); item.type = "button"; item.onclick = () => run(action); return item; }
  async function run(action) {
    if (busy) return;
    busy = true;
    try { await action(); await refresh(true); }
    catch (error) { feedback(error.message, true); }
    finally { busy = false; }
  }
  function badge(priority) { const item = node("span", priority, "badge"); item.dataset.priority = priority; return item; }
  function date(value) { return value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "não disponível"; }
  async function refresh(force = false) {
    state = await api("/state");
    $("controls").hidden = false;
    $("provider").textContent = state.provider_configured ? "Chave Jev configurada no serviço" : "Jev: configure TYPESAFE_API_KEY no serviço local";
    const container = $("conversations");
    const ordered = [...state.conversations].sort((a, b) => {
      const score = (x) => x.result ? priorities.indexOf(x.result.priority) : 5;
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });
    const newListStamp = JSON.stringify(ordered.map((c) => [c.id, c.name, c.result?.priority, c.status, selected === c.id]));
    if (newListStamp !== listStamp) {
    container.replaceChildren(); listStamp = newListStamp;
    for (const conversation of ordered) {
      const item = button("", async () => { selected = conversation.id; detailStamp = ""; detailDirty = false; });
      item.className = "conversation"; item.setAttribute("aria-pressed", String(selected === conversation.id));
      item.append(node("strong", conversation.name), badge(conversation.result?.priority || "Sem análise"), node("small", statuses[conversation.status] || conversation.status));
      container.append(item);
    }
    if (!ordered.length) container.append(node("p", "Nenhuma conversa autorizada.", "muted"));
    }
    if (selected && !ordered.some((x) => x.id === selected)) { selected = null; $("detail").replaceChildren(node("p", "Dados da conversa excluídos.")); }
    if (selected) {
      const conversation = ordered.find((x) => x.id === selected);
      const stamp = `${conversation.version}:${conversation.status}:${conversation.analyzed_at}`;
      if ((force || stamp !== detailStamp) && (force || !detailDirty)) { await showDetail(selected); detailStamp = stamp; detailDirty = false; }
    }
    if (!rulesDirty && !$("rules").contains(document.activeElement)) for (const [key, value] of Object.entries(state.rules)) $("rules").elements.namedItem(key).value = value;
  }
  async function showDetail(cid) {
    const { conversation: c, messages } = await api(`/conversations/${encodeURIComponent(cid)}`);
    const root = $("detail"); root.replaceChildren(node("h2", c.name));
    root.append(node("p", `Histórico parcial · última coleta: ${date(c.last_collected)} · contexto v${c.version}`, "muted"));
    root.append(node("p", statuses[c.status] || c.status, c.status !== "ready" ? "warning" : ""));
    if (c.error) root.append(node("p", c.error, "danger"));
    const consent = document.createElement("form");
    const local = document.createElement("input"); local.type = "checkbox"; local.checked = c.collect;
    const external = document.createElement("input"); external.type = "checkbox"; external.checked = c.external; external.disabled = !local.checked;
    for (const [control, text] of [[local, " Autorizar coleta local"], [external, " Autorizar análise externa pelo Jev após revisão dos trechos"]]) {
      const label = node("label", ""); label.append(control, document.createTextNode(text)); consent.append(label);
    }
    local.onchange = () => { external.disabled = !local.checked; if (!local.checked) external.checked = false; };
    const role = document.createElement("input"); role.maxLength = 160; role.value = c.role;
    const relation = document.createElement("input"); relation.maxLength = 160; relation.value = c.relation;
    for (const [control, text] of [[role, "Função conhecida (opcional)"], [relation, "Relação comigo (opcional)"]]) { const label = node("label", text); label.append(control); consent.append(label); }
    const save = node("button", "Salvar autorizações e contexto"); save.type = "submit"; consent.append(save);
    consent.onsubmit = (event) => { event.preventDefault(); run(async () => { await api("/consent", "POST", { id: cid, name: c.name, collect: local.checked, external: external.checked, role: role.value, relation: relation.value }); document.activeElement?.blur(); feedback("Autorizações salvas. Envio exige revisão dos trechos."); }); };
    root.append(consent);
    const tools = node("div", "", "tools");
    const analyze = button("Revisar trechos e analisar", async () => {
      const preview = await api(`/conversations/${encodeURIComponent(cid)}/preview`);
      previewHash = preview.context_hash; previewId = cid;
      $("preview-content").textContent = JSON.stringify(preview.state, null, 2);
      $("preview-info").textContent = preview.blocked || `${preview.bytes} bytes · Contexto selecionado automaticamente; consulte context_selection para a cobertura · IDs de participantes anonimizados · contexto aprovado pode ser reavaliado quando um prazo se aproximar.`;
      $("approve").disabled = Boolean(preview.blocked);
      $("preview").showModal();
    }); analyze.disabled = !c.collect || !c.external; tools.append(analyze);
    if (/^\d{8,15}@(?:c\.us|s\.whatsapp\.net)$/.test(cid)) {
      const link = node("a", "Abrir conversa", "open-link"); link.href = `https://web.whatsapp.com/send?phone=${encodeURIComponent(cid.split("@")[0])}`; link.target = "_blank"; link.rel = "noopener noreferrer"; tools.append(link);
      root.append(node("p", "Abrir por clique pode gerar recibos normais de leitura do WhatsApp.", "muted"));
    } else if (!cid.startsWith("sample:")) {
      tools.append(button("Localizar conversa no WhatsApp", async () => {
        await navigator.clipboard.writeText(c.name);
        window.open("https://web.whatsapp.com/", "_blank", "noopener,noreferrer");
        feedback("Nome copiado. Localize a conversa pela busca do WhatsApp; grupos não têm link estável neste protótipo.");
      }));
    }
    tools.append(button("Excluir dados locais", async () => {
      if (!confirm("Excluir coleta, resultados e correções locais desta conversa? Envios anteriores ao Jev não podem ser desfeitos.")) return;
      await api(`/conversations/${encodeURIComponent(cid)}`, "DELETE"); selected = null; root.replaceChildren(node("p", "Dados locais excluídos.")); feedback("Dados locais excluídos; coleta interrompida.");
    })); root.append(tools);
    const result = c.result;
    if (result) {
      root.append(badge(result.priority));
      root.append(node("p", `Confiança retornada: ${result.confidence == null ? "indisponível" : `${(result.confidence * 100).toFixed(1)}%`} · análise v${result.context_version}${result.context_version !== c.version || c.status !== "ready" ? " · resultado desatualizado / correção local" : ""}`, "muted"));
      if (result.review_reason) root.append(node("p", result.review_reason, "warning"));
      if (!result.pending.length && messages.length) {
        const form = document.createElement("form"); const select = document.createElement("select");
        for (const p of priorities) { const option = node("option", p); option.value = p; select.append(option); } select.value = result.priority;
        const label = node("label", "Corrigir prioridade da conversa"); label.append(select); form.append(label);
        const submit = node("button", "Salvar correção da conversa"); submit.type = "submit"; form.append(submit);
        form.onsubmit = (event) => { event.preventDefault(); run(async () => { await api(`/conversations/${encodeURIComponent(cid)}/corrections`, "POST", { pending_id: "__conversation__", priority: select.value, owner: "Desconhecido", resolved: false }); document.activeElement?.blur(); feedback("Prioridade corrigida localmente."); }); }; root.append(form);
      }
      for (const pending of result.pending) {
        const card = node("article", "", "card"); card.append(badge(pending.priority), node("h3", pending.resolved ? "Pendência resolvida" : "Ação pendente"), node("p", pending.action, "action"));
        card.append(node("p", `Responsável: ${pending.owner} · prazo: ${pending.deadline ? `${pending.deadline.value} (${pending.deadline.precision === "day" ? "dia, sem horário definido" : "horário explícito"})` : "não informado"}`));
        card.append(node("p", `Confiança da prioridade no modelo: ${(pending.model_confidence * 100).toFixed(1)}%${pending.corrected ? " · corrigido por você" : ""}`, "muted"));
        if (pending.review_reason && !pending.corrected) card.append(node("p", pending.review_reason, "warning"));
        if (pending.priority === "Revisar" && pending.model_priority !== "Revisar") card.append(node("p", `Sugestão do Jev: ${pending.model_priority}. A decisão exige revisão.`, "muted"));
        for (const id of pending.evidence_ids) {
          const source = messages.find((m) => m.id === id);
          if (!source) continue;
          const excerpt = node("div", "", "source"); excerpt.append(node("small", `${source.author} · ${date(source.sent_at)} · ${source.id}`), node("p", source.text || "Áudio não transcrito"));
          if (source.quoted) excerpt.append(node("p", `Citação: ${source.quoted}`, "muted")); card.append(excerpt);
        }
        const form = document.createElement("form");
        const select = document.createElement("select"); for (const p of priorities) { const option = node("option", p); option.value = p; select.append(option); } select.value = pending.priority;
        const owner = document.createElement("select"); for (const name of new Set(["Eu", "Desconhecido", ...messages.map((m) => m.author)])) { const option = node("option", name); option.value = name; owner.append(option); } owner.value = pending.owner;
        const resolved = document.createElement("input"); resolved.type = "checkbox"; resolved.checked = pending.resolved;
        for (const [control, text] of [[select, "Corrigir prioridade"], [owner, "Corrigir responsável"], [resolved, " Confirmar resolução"]]) { const label = node("label", text); label.append(control); form.append(label); }
        const submit = node("button", "Salvar correção"); submit.type = "submit"; form.append(submit);
        form.onsubmit = (event) => { event.preventDefault(); run(async () => { await api(`/conversations/${encodeURIComponent(cid)}/corrections`, "POST", { pending_id: pending.id, priority: select.value, owner: owner.value, resolved: resolved.checked }); document.activeElement?.blur(); feedback("Correção aplicada localmente e guardada para próximos contextos."); }); };
        card.append(form); root.append(card);
      }
    }
    const history = document.createElement("details"); history.append(node("summary", `${messages.length} mensagens coletadas neste PC`));
    for (const m of messages) { const entry = node("div", "", "source"); entry.append(node("small", `${m.author} · ${date(m.sent_at)}`), node("p", m.text || "Áudio ainda não transcrito")); history.append(entry); } root.append(history);
  }
  $("refresh").onclick = () => run(async () => { detailStamp = ""; feedback("Atualizado."); });
  $("rules").onsubmit = (event) => { event.preventDefault(); run(async () => { const values = new FormData($("rules")); await api("/rules", "POST", { near_hours: Number(values.get("near_hours")), confidence: Number(values.get("confidence")), retention_days: Number(values.get("retention_days")), instructions: values.get("instructions"), user_name: values.get("user_name") }); rulesDirty = false; feedback("Regras salvas; próximos envios exigem nova revisão."); }); };
  $("close-preview").onclick = () => $("preview").close();
  $("approve").onclick = () => run(async () => { await api(`/conversations/${encodeURIComponent(previewId)}/analyze`, "POST", { context_hash: previewHash }); $("preview").close(); feedback("Contexto aprovado. Consultando Jev externo…"); });
  (async () => {
    try { if (ticket) await api("/session", "POST", { ticket }); await refresh(); feedback("Painel local conectado. Nenhuma mensagem enviada sem autorização e revisão."); }
    catch (error) { feedback(error.message, true); }
  })();
  setInterval(async () => { if (!busy && !$("preview").open && !$("controls").hidden) try { await refresh(); } catch (error) { feedback(error.message, true); } }, 5000);
})();
