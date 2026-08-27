import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../../extension/setup.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../../extension/setup.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../extension/setup.css", import.meta.url), "utf8");
const installer = fs.readFileSync(new URL("../../scripts/instalar.ps1", import.meta.url), "utf8");

test("painel expõe saúde e ações de instalação", () => {
  for (const id of ["health-card", "model", "device", "queue", "retry", "install", "start", "reload", "extension-path", "update", "feedback"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /role="status"/);
  assert.match(html, /local-config\.js/);
  assert.match(script, /HEALTH_CHECK/);
  assert.match(script, /instalar\.bat/);
  assert.match(script, /iniciar\.bat/);
  assert.match(script, /Ctrl\+Shift\+R/);
  assert.match(html, /github\.com\/renanrmsantos14\/whatsapp-transcritor-local\/archive\/refs\/heads\/master\.zip/);
  assert.match(installer, /WriteAllText/);
  assert.match(installer, /UTF8Encoding\(\$false\)/);
});

test("painel mantém acessibilidade e tema sem dependências externas", () => {
  assert.match(html, /lang="pt-BR"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.doesNotMatch(html + script + css, /😀|📝/u);
});
