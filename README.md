# WhatsApp Transcritor Local

MVP gratuito para mostrar, abaixo de cada nota de voz recebida no WhatsApp Web, uma transcrição feita localmente por `faster-whisper`.

## Requisitos

- Windows 10/11 x64
- Chrome 142+
- Internet somente na instalação inicial para Python, pacotes e modelo
- Recomendado: 16 GB RAM; o modelo `small` usa CPU `int8` neste Inspiron

O backend não exige FFmpeg instalado: o `faster-whisper` usa PyAV para decodificar áudio.

## Instalação

1. Execute `scripts\instalar.bat`.
2. Aguarde o download e warm-up do modelo `small`.
3. Abra `chrome://extensions`.
4. Ative **Modo do desenvolvedor**.
5. Clique **Carregar sem compactação** e selecione a pasta `extension`.
6. Abra a página da extensão uma vez para conceder/testar acesso ao localhost.
7. Abra `https://web.whatsapp.com/` e recarregue a aba.

O instalador cria inicialização silenciosa no login do Windows. Para diagnóstico, execute `scripts\iniciar.bat`.

## Comportamento

- Somente notas recebidas e renderizadas são processadas automaticamente.
- Ao clicar para escutar uma nota de voz, a extensão também captura e transcreve aquele áudio em reprodução, seja recebido ou enviado.
- Áudios fora do DOM virtualizado aparecem quando forem carregados ao rolar.
- Fila mantém uma transcrição por vez.
- Cache fica em `chrome.storage.local`; áudio nunca é persistido pelo projeto.
- A captura precisa acionar o controle do WhatsApp. Mesmo sem som, o WhatsApp pode marcar o áudio como ouvido.

## Testes

```powershell
python -m pytest -q
node --test tests/extension/*.test.mjs
```

O smoke test de modelo real é separado para não baixar pesos durante cada execução de testes.

## Limitações reais

O WhatsApp Web não oferece API pública para áudio descriptografado. A extensão usa um hook de página e fallback estrutural; qualquer mudança de DOM pode exigir ajuste em `extension/selectors.js`.

Status só pode ser **funcionando** após validação em WhatsApp Web autenticado com áudio real.
