# WhatsApp Transcritor Local

MVP gratuito para mostrar, abaixo de cada nota de voz recebida no WhatsApp Web, uma transcrição feita localmente por `faster-whisper`.

## Requisitos

- Windows 10/11 x64
- Chrome 142+
- Internet somente na instalação inicial para Python, pacotes e modelo
- Recomendado: 16 GB RAM; o modelo `small` usa CPU `int8` neste Inspiron

O backend não exige FFmpeg instalado: o `faster-whisper` usa PyAV para decodificar áudio.

## Instalação

Clone o repositório público e entre na pasta do projeto:

```powershell
git clone https://github.com/renanrmsantos14/whatsapp-transcritor-local.git
cd whatsapp-transcritor-local
```

1. Execute `scripts\instalar.bat`.
2. Aguarde o download e warm-up do modelo `small`.
3. Abra `chrome://extensions`.
4. Ative **Modo do desenvolvedor**.
5. Clique **Carregar sem compactação** e selecione a pasta `extension`.
6. Abra a página da extensão uma vez para conceder/testar acesso ao localhost.
7. Abra `https://web.whatsapp.com/` e recarregue a aba.

O instalador cria inicialização silenciosa no login do Windows. Para diagnóstico, execute `scripts\iniciar.bat`.

## Atualização

Dentro da pasta clonada, execute:

```powershell
git pull --ff-only
```

Isso atualiza os arquivos locais da extensão e do backend sem sobrescrever os arquivos gerados localmente (`.venv`, token, configuração e modelo). Depois do pull, o Chrome ainda precisa recarregar a extensão em `chrome://extensions`; como os scripts são injetados no WhatsApp Web, também recarregue a aba com `Ctrl + Shift + R`.

O Chrome exige esse reload para mudanças no manifesto, service worker e content scripts quando a extensão foi instalada como **Carregar sem compactação**. O comando `git pull` sozinho não consegue clicar nessa interface do Chrome.

Para executar o fluxo guiado, use `scripts\atualizar.bat`.

## Painel de controle

Clique no ícone da extensão para abrir o painel local. Ele mostra se o backend e o modelo estão prontos, além da fila, dispositivo e ações de manutenção:

- **Instalar ou atualizar** copia o comando do instalador idempotente. Use no PowerShell do computador destino; ele instala Python, dependências e o modelo.
- **Iniciar backend** copia o comando para executar o serviço local em modo visível.
- **Recarregar WhatsApp Web** copia `Ctrl + Shift + R`, que deve ser usado na aba do WhatsApp.
- **Copiar caminho da extensão** ajuda no passo **Carregar sem compactação** do Chrome.

Por segurança, uma extensão Chrome não pode executar arquivos `.bat` nem controlar abas do sistema sem permissões nativas adicionais. Por isso as ações de manutenção são explícitas e copiáveis; nenhuma delas altera o fluxo normal do WhatsApp.

## Comportamento

- Cada nota de voz recebida ou enviada renderizada ganha um botão discreto **Transcrever**.
- Nada é reproduzido, baixado ou enviado sem clique explícito nesse botão.
- O clique captura a nota selecionada, envia somente ao backend local e mostra o resultado abaixo da bolha.
- Áudios fora do DOM virtualizado aparecem quando forem carregados ao rolar.
- Fila mantém uma transcrição por vez.
- Cache fica em `chrome.storage.local`; áudio nunca é persistido pelo projeto.
- O texto restaurado automaticamente permanece por 7 dias a partir da transcrição; depois disso o registro é removido.
- A transcrição segue o lado da mensagem: recebida à esquerda e enviada à direita.
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
