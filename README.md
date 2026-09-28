# WhatsApp Transcritor Local

MVP gratuito para mostrar, abaixo de cada nota de voz recebida no WhatsApp Web, uma transcrição feita localmente por `faster-whisper`.

## Requisitos

- Windows 10/11 x64 ou Linux x64 (Ubuntu/Mint e derivados)
- Chrome 142+
- Transcrição: internet somente na instalação inicial para Python, pacotes e modelo
- Assistente de prioridades opcional: internet e chave Jev para análise externa de trechos aprovados
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
5. Clique **Carregar sem compactação** e selecione a pasta `extension`.
6. Abra a página da extensão uma vez para conceder/testar acesso ao localhost.
7. Abra `https://web.whatsapp.com/` e recarregue a aba.

O instalador cria inicialização silenciosa no login do Windows. Para diagnóstico, execute `scripts\iniciar.bat`.

### Linux

```bash
chmod +x scripts/*.sh
./scripts/instalar.sh
```

O instalador Linux cria o ambiente virtual, instala as dependências, gera o token local, faz o warm-up dos modelos e configura o início automático pela sessão do usuário. Para diagnóstico, execute `./scripts/iniciar.sh`.

## Atualização

Dentro da pasta clonada, execute:

```powershell
git pull --ff-only
```

Isso atualiza os arquivos locais da extensão e do backend sem sobrescrever os arquivos gerados localmente (`.venv`, token, configuração e modelo). Depois do pull, o Chrome ainda precisa recarregar a extensão em `chrome://extensions`; como os scripts são injetados no WhatsApp Web, também recarregue a aba com `Ctrl + Shift + R`.

O Chrome exige esse reload para mudanças no manifesto, service worker e content scripts quando a extensão foi instalada como **Carregar sem compactação**. O comando `git pull` sozinho não consegue clicar nessa interface do Chrome.

Para executar o fluxo guiado, use `scripts\atualizar.bat` no Windows ou `./scripts/atualizar.sh` no Linux.

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

No Linux, use os mesmos comandos com `python3` quando o ambiente virtual ainda não estiver ativado.

O smoke test de modelo real é separado para não baixar pesos durante cada execução de testes.

## Limitações reais

O WhatsApp Web não oferece API pública para áudio descriptografado. A extensão usa um hook de página e fallback estrutural; qualquer mudança de DOM pode exigir ajuste em `extension/selectors.js`.

Status só pode ser **funcionando** após validação em WhatsApp Web autenticado com áudio real.

## Assistente de prioridades com Jev (protótipo)

A coleta, o banco e a transcrição acontecem neste PC. Os trechos aprovados são enviados ao Jev, um serviço externo. A análise não é inteiramente local. O assistente não envia respostas, não abre/rola conversas automaticamente e não apaga, arquiva ou marca mensagens como lidas.

### Usar

1. Atualize as dependências com `.venv/bin/python -m pip install --require-hashes -r server/requirements.lock` (Windows: `.venv\Scripts\python.exe`).
2. Configure `TYPESAFE_API_KEY` no ambiente do serviço ou salve a chave em `server/.assistant-key`, arquivo privado ignorado pelo Git. No Linux, use permissão `600`. Nunca coloque a chave na extensão ou envie pelo chat.
3. Inicie `scripts/iniciar.sh` / `scripts\iniciar.bat`. Recarregue a extensão em `chrome://extensions` e depois a aba do WhatsApp Web.
4. Na conversa aberta, clique **Autorizar coleta local desta conversa**. Conversas não selecionadas não têm corpos de mensagens coletados.
5. No popup da extensão, abra **Painel de prioridades**. O botão cria uma sessão local de uso único, sem expor o token permanente em URLs.
6. Informe **Meu nome nas mensagens**, quando conhecido, e suas regras. Autorize o envio externo separadamente por conversa, revise o contexto e aprove os trechos.
7. Corrija prioridades/responsáveis ou confirme resolução pelo painel. Mensagens novas, edições, regras e correções invalidam a aprovação; o novo contexto precisa de revisão antes de sair do PC.

A sessão do painel dura até oito horas e termina ao reiniciar o serviço. O serviço escuta somente `127.0.0.1:8765`; o painel é servido em `/assistant`. Prazos podem provocar nova análise do mesmo contexto já aprovado, inclusive após reiniciar o serviço. Não há notificações na primeira versão.

### Contexto e limitações

- Histórico parcial: somente mensagens renderizadas. Conversas fechadas não são monitoradas pelo coletor.
- Autor, horário, lado da mensagem, citações disponíveis, compromissos anteriores, regras e correções acompanham as fontes. Horários não interpretáveis ficam explicitamente ausentes.
- A primeira análise precisa caber em 40 mensagens relevantes / 60 KB de contexto. Até 12 possíveis pendências por conversa. Excessos viram **Revisar**, sem truncamento silencioso ou envio externo.
- Após uma análise aceita, o serviço pode omitir mensagens antigas já analisadas e sem pendências. Mantém origens abertas, todas as respostas posteriores, mensagens novas/editadas e referências citadas. Mudanças nas regras restauram o contexto completo para nova avaliação.
- Jev decide origem, responsável, prazo dentre candidatos existentes, evidência, prioridade e continuidade de uma mesma pendência. As ações mostradas são trechos originais, sem texto livre inventado. Confiança da prioridade abaixo de `0.85` exige revisão; decisões auxiliares incertas também podem bloquear a classificação.
- Prazo próximo: vencido ou em até duas horas. Datas relativas usam a data da mensagem e `America/Sao_Paulo`. Prazos sem horário permanecem datas, sem assumir meia-noite como hora limite.
- Áudios só entram após transcrição local já existente no cache. O assistente não cria jobs nem aciona o player. Áudio/metadados ausentes exigem revisão. A transcrição automática anterior é independente e pode gerar recibo de reprodução; desligue-a no popup se quiser uma sessão totalmente passiva.
- Conversas individuais com número disponível têm link de abertura por clique. Para grupos/identificadores sem link seguro, o painel permite copiar o nome e localizar pela busca do WhatsApp. Aberturas manuais podem produzir recibos normais de leitura.
- Retenção: 30 dias desde a coleta, configurável. Pendências abertas e evidências de correções são preservadas. Excluir remove mensagens, resultados, snapshots aprovados e correções locais, interrompendo consultas seguintes. Conteúdo já enviado ao provedor não pode ser recuperado por essa exclusão.
- Credenciais reconhecíveis e as chaves conhecidas são removidas do contexto; revise o preview para outros dados sensíveis. Cookies e sessão do WhatsApp nunca são acessados pelo coletor. A API rejeita campos extras e só envia campos explicitamente construídos.
- Correções viram exemplos do próprio contexto, sem treinamento automático. Nenhum modelo complementar foi adicionado; extração livre exigirá avaliação e consentimento próprio se futuramente for necessária.

### Validação

```bash
.venv/bin/python -m pytest -q tests/test_assistant.py
node tests/assistant-collector.test.mjs
.venv/bin/python scripts/validar-assistente.py --live
```

Os testes offline usam um avaliador substituto para validar contratos e proteção de dados; não medem a precisão do Jev. A validação `--live` envia somente conversas sintéticas: 15 casos de desenvolvimento e quatro casos separados de avaliação. O relatório fica em `outputs/assistant-validation.json`, com categoria, responsável, fonte do prazo, evidências, confiança e divergências. Exemplos reais precisam ser selecionados e aprovados por você.

### Coleta automática local

Conversas abertas no WhatsApp Web são coletadas automaticamente neste PC, sem botão. Apenas mensagens renderizadas são acessíveis. Conversas pausadas ou excluídas no painel não são reativadas automaticamente. Envio ao Jev continua exigindo autorização externa e aprovação dos trechos.
