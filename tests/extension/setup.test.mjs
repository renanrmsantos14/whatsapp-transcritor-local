import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../../extension/setup.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../../extension/setup.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../extension/setup.css", import.meta.url), "utf8");

test("popup prioriza saúde local e configurações expansíveis", () => {
  for (const id of ["health-card", "health-title", "health-detail", "model", "queue", "versions", "retry", "cache-toggle", "cache-panel", "glossary-toggle", "glossary-panel", "diagnostics-toggle", "diagnostics-panel", "glossary", "clear-cache", "save-glossary", "copy-diagnostics", "feedback"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /WhatsApp Transcritor/);
  assert.match(html, /Processamento local/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="(?:cache|glossary|diagnostics)-panel"/);
  assert.match(html, /role="status"/);
  for (const removed of ["id=\"install\"", "id=\"start\"", "id=\"reload\"", "id=\"extension-path\"", "id=\"update\"", "github.com"]) assert.doesNotMatch(html, new RegExp(removed));
});

test("popup mantém contratos, estados e validação local", () => {
  for (const message of ["HEALTH_CHECK", "DIAGNOSTICS_GET", "SETTINGS_GET", "SETTINGS_UPDATE", "CACHE_CLEAR"]) assert.match(script, new RegExp(message));
  for (const state of ["checking", "ready", "error", "Serviço local indisponível", "Versão incompatível"]) assert.match(script + css, new RegExp(state));
  assert.match(script, /normalizeGlossary/);
  assert.match(script, /glossary\.length > 200/);
  assert.match(script, /new Blob\(\[JSON\.stringify\(glossary\)\]\)\.size > 8192/);
  assert.match(script, /window\.confirm/);
});

test("popup mantém acessibilidade e tema sem dependências externas", () => {
  assert.match(html, /lang="pt-BR"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /\.sr-only/);
  assert.doesNotMatch(html + script + css, /😀|📝/u);
});
