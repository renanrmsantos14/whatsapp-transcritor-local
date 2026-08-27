# WhatsApp Transcritor Local

## Objetivo

Transcrever automaticamente notas de voz recebidas no WhatsApp Web usando Whisper local, sem enviar áudio ou texto para serviços externos.

## Arquitetura

- `extension/`: extensão Chrome Manifest V3. Detecta notas recebidas, captura o blob no page world, mantém cache e injeta a transcrição.
- `server/`: FastAPI em `127.0.0.1:8765`, com `faster-whisper` e fila de uma transcrição por vez.
- `scripts/`: instalação, inicialização visível e inicialização silenciosa no Windows.
- `tests/`: testes de API, transcrição e fixtures de DOM.

## Privacidade e segurança

- Processamento diário ocorre somente em localhost.
- Não adicionar OpenAI API, SaaS, analytics, telemetria, banco externo ou upload manual.
- O servidor deve permanecer em `127.0.0.1`, validar token, tamanho e tipo, e excluir temporários sempre.
- Nunca registrar conteúdo de áudio ou texto nos logs.

## Compatibilidade WhatsApp Web

Seletores mudam com frequência. Toda detecção deve ficar centralizada em `extension/selectors.js`, com fallback estrutural e diagnóstico. Não depender de classes geradas ou APIs internas não documentadas.

Captura pode precisar acionar o controle de reprodução para obter o blob descriptografado. O áudio deve permanecer inaudível, mas o WhatsApp pode marcar a mensagem como ouvida.

## Como testar

```powershell
python -m pytest -q
node --test tests/extension/*.test.mjs
```

Para teste real: iniciar `scripts/iniciar.bat`, carregar `extension/` em `chrome://extensions`, abrir WhatsApp Web autenticado e validar o checklist do README.

## Diagnóstico

1. `GET /health` pelo `setup.html`.
2. Conferir `logs/backend.log` sem esperar conteúdo de transcrição.
3. Conferir `netstat -ano | findstr :8765` e exigir `127.0.0.1:8765`.
4. Se o hook não responder, recarregar a extensão e usar `Ctrl+Shift+R` no WhatsApp.
5. Se o DOM mudar, atualizar somente `selectors.js` e registrar a evidência no diagnóstico.

