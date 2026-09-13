# WhatsApp Transcritor Local

MVP gratuito para mostrar, abaixo de cada nota de voz recebida no WhatsApp Web, uma transcrição feita localmente por `faster-whisper`.

## Requisitos

- Windows 10/11 x64
- Chrome 142+
- Internet somente na instalação inicial para Python, pacotes e modelo
- Recomendado: 16 GB RAM; os modelos `base` e `small` usam CPU `int8` neste Inspiron

O backend não exige FFmpeg instalado: o `faster-whisper` usa PyAV para decodificar áudio.

## Instalação

Clone o repositório público e entre na pasta do projeto:

```powershell
git clone https://github.com/renanrmsantos14/whatsapp-transcritor-local.git
cd whatsapp-transcritor-local
```

1. Execute `scripts\instalar.bat`.
2. Aguarde o download e warm-up dos modelos locais `base` e `small`.
3. Abra `chrome://extensions`.
4. Ative **Modo do desenvolvedor**.
5. Clique **Carregar sem compactação** e selecione a pasta exibida pelo instalador, normalmente `%LOCALAPPDATA%\Betinhos\WhatsAppTranscritor\extension`.
6. Abra a página da extensão uma vez para conceder/testar acesso ao localhost.
7. Abra `https://web.whatsapp.com/` e recarregue a aba.

Use a cópia em `%LOCALAPPDATA%`, não a pasta `extension` do clone. O instalador mantém essa cópia em caminho estável e atualiza os arquivos nela.

Extensão carregada sem compactação continua sendo uma instalação de desenvolvimento. O Chrome pode removê-la ou exigir novo carregamento conforme o perfil, política ou limpeza do navegador. Para instalação permanente, use a Chrome Web Store ou uma política corporativa de instalação.

O instalador cria inicialização silenciosa no login do Windows. Para diagnóstico, execute `scripts\iniciar.bat`.

## Atualização

Dentro da pasta clonada, execute:

```powershell
git pull --ff-only
```

Isso atualiza os arquivos locais da extensão e do backend sem sobrescrever os arquivos gerados localmente (`.venv`, token, configuração e modelo). Depois do pull, o Chrome ainda precisa recarregar a extensão em `chrome://extensions`; como os scripts são injetados no WhatsApp Web, também recarregue a aba com `Ctrl + Shift + R`.

O Chrome exige esse reload para mudanças no manifesto, service worker e content scripts quando a extensão foi instalada como **Carregar sem compactação**. O comando `git pull` sozinho não consegue clicar nessa interface do Chrome. Se a extensão sumir após reiniciar, carregue novamente a mesma pasta estável em `%LOCALAPPDATA%\Betinhos\WhatsAppTranscritor\extension`.

Para executar o fluxo guiado, use `scripts\atualizar.bat`.

O painel da extensão é focado no estado do serviço e nas configurações locais. Atualizações continuam sendo feitas pelos scripts acima; para uma cópia já clonada, `git pull --ff-only` continua sendo o caminho recomendado.

## Painel de controle

Clique no ícone da extensão para abrir o painel **WhatsApp Transcritor**. O resumo mostra se o backend e o modelo estão prontos, além da fila e da versão. **Dados locais**, **Glossário local** e **Diagnóstico** ficam recolhidos até serem necessários; o diagnóstico nunca inclui áudio ou texto das mensagens.

Instalação, atualização, inicialização do backend e recarga do WhatsApp continuam explícitas nos scripts e neste README. O popup não executa comandos do sistema nem altera o fluxo normal do WhatsApp.

## Comportamento

- Cada nota de voz recebida ou enviada renderizada ganha um botão discreto **Transcrever**.
- O popup permite priorizar velocidade, equilíbrio ou precisão sem expor configurações técnicas.
- A transcrição automática é opcional e processa em sequência os áudios recebidos ainda não escutados, inclusive antigos renderizados ao abrir ou rolar a conversa.
- Nada é reproduzido, baixado ou enviado sem clique explícito nesse botão.
- O clique captura a nota selecionada, envia somente ao backend local e mostra o resultado abaixo da bolha.
- Áudios fora do DOM virtualizado aparecem quando forem carregados ao rolar.
- Fila mantém uma transcrição por vez.
- Cache fica em `chrome.storage.local`; áudio nunca é persistido pelo projeto.
- O texto restaurado automaticamente permanece por 7 dias a partir da transcrição; depois disso o registro é removido.
- A transcrição segue o lado da mensagem: recebida à esquerda e enviada à direita.
- A captura tenta obter o blob pelo download. Quando precisa acionar o controle, bloqueia temporariamente tanto o player HTML quanto a saída Web Audio; a interface ou o recibo do WhatsApp ainda pode indicar reprodução.

## Testes

```powershell
python -m pytest -q
node --test tests/extension/*.test.mjs
```

O smoke test de modelo real é separado para não baixar pesos durante cada execução de testes.

## Limitações reais

O WhatsApp Web não oferece API pública para áudio descriptografado. A extensão usa um hook de página e fallback estrutural; qualquer mudança de DOM pode exigir ajuste em `extension/selectors.js`.

Status só pode ser **funcionando** após validação em WhatsApp Web autenticado com áudio real.
