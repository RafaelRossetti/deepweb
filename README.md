# THOR · DeepWeb Arena

Arena educacional para a retrospectiva da Fecart. Os comandos são **simulados dentro da aplicação**; os documentos capturados são PDFs reais. Não executa Kali nem comandos do sistema operacional do servidor.

## Testar agora

Precisa de Node.js 24. Não há dependências de produção para instalar.

```powershell
cd C:\Projetos\deepweb
npm start
```

Abra **http://localhost:3000** como professor. Sem `.env`, a criação de atividades está liberada apenas pelo localhost. Os alunos podem entrar pelo endereço de rede do servidor. Configure `TEACHER_PASSWORD` se quiser abrir atividades como professor de outro computador. Todos devem ter acesso à porta 3000 do servidor na rede local.

Para representar vários alunos no mesmo computador, use perfis ou janelas anônimas independentes. Abas no mesmo perfil compartilham a sessão salva. Recarregar a página retoma a atividade neste navegador.

## Jornada

1. Professor abre a atividade e compartilha o código.
2. Os alunos entram com nome; o professor seleciona dois ou três e nomeia cada equipe.
3. Os integrantes escolhem ataque ou defesa. Cada equipe precisa de pelo menos um atacante e um defensor; o terceiro reforça uma dessas funções.
4. Professor libera a preparação e envia um PDF de até **3 MiB** por equipe enquanto os alunos estudam e ensaiam os comandos.
5. Quando todos os PDFs e papéis estão prontos, escolhe a duração e inicia.
6. Atacantes executam `scan` → `inspect` → `access` → `extract`. Defensores selecionam **uma conexão** e a resposta adequada à etapa: `reroute` após reconhecimento, `block` após inspeção ou `revoke` após acesso. Um desvio representa um IP virtual e afeta somente a conexão selecionada.
7. Professor pode transmitir avisos centrais, enviar efeitos visuais a um grupo, consultar métricas por integrante, acrescentar tempo e encerrar. O prazo é validado pelo servidor.
8. O ranking final aparece nos participantes e na tela pública.

Até **20 equipes e 60 participantes**. Por padrão, cada equipe recebe no máximo dois ataques simultâneos. Um atacante mantém uma conexão por vez; a captura conclui sua conexão e permite escolher outro alvo. **Trocar alvo** encerra somente a conexão daquele atacante e reinicia seu progresso, preservando o intervalo entre ações.

## Comandos e equilíbrio

Cada jogador pode clicar uma vez em cada comando durante a atividade. O botão preenche a primeira tentativa; nas seguintes, o jogador deve escrever o comando exatamente como está no catálogo. A regra fica salva no servidor e permanece após atualizar a página. Comandos incorretos não alteram incidentes, pontos ou a reserva de defesa. Colagem e arraste de texto ficam bloqueados nos campos de comando da rodada. O treino continua livre, sem pontuação.

- Ataque: **4 segundos** entre comandos, inclusive ao trocar de alvo. Sem interferência, as quatro etapas exigem pelo menos 12 segundos.
- Defesa: **5 segundos por jogador**, inclusive ao mudar de conexão. Cada resposta válida consome uma carga da reserva compartilhada da equipe.
- Reserva: **2 cargas**, recuperando **1 a cada 8 segundos**, até o máximo de duas. Dois defensores usam a mesma reserva; cada ação afeta um atacante.
- Proteção contra autoclique: comandos enviados usam uma autorização de uso único. Reenvios e rajadas inválidas não executam novas ações; quatro violações em cinco segundos suspendem os comandos daquele jogador por oito segundos.

Esses parâmetros são um ponto de partida para o ensaio: observe vazamentos, comandos rejeitados e respostas dos grupos antes de usá-los para avaliação. As restrições de colagem e digitação orientam a interface; não comprovam digitação humana contra scripts que manipulem o navegador ou chamem a API.

## Métricas, avisos e efeitos

O professor vê o número de vazamentos rapidamente nas equipes e pode abrir o detalhamento: pontos por origem, capturas, defesas, conexões, atividade por integrante, comandos rejeitados e quais equipes extraíram o PDF. Um vazamento corresponde a uma captura por equipe adversária, sem duplicação. Os nomes individuais e métricas detalhadas ficam fora da tela pública.

Avisos aparecem em uma janela central para os jogadores, com confirmação de leitura. O catálogo tem dez efeitos: Glitch, Terremoto, Neblina, Espelho, Chuva de código, Monitor antigo, Modo blecaute, Pulso do cofre, Vento digital e Maré de dados. Duram de 5 a 20 segundos, um por grupo, podem ser encerrados pelo professor e não alteram pontos ou conexões. Os jogadores podem reduzir os efeitos; a preferência de movimento reduzido do navegador é respeitada.

## Pontuação

- **50 por captura:** uma única extração por par equipe atacante/equipe alvo. Dois integrantes tentando capturar simultaneamente não duplicam pontos ou PDF.
- **5 por defesa válida:** exige uma nova etapa do atacante, a ferramenta correta para o estágio, intervalo por jogador e uma carga disponível. Afeta somente o incidente selecionado. Consultar logs não soma pontos nem gasta carga.
- **50 por proteção final:** para a equipe cujo documento não foi extraído por nenhum adversário. Aplicado uma única vez no encerramento.

A captura libera um acesso de uso único ao PDF, válido por dez minutos. O arquivo não fica exposto no frontend ou no Git. O servidor registra a captura antes de entregar o acesso ao download: se a rede cair após a extração, a pontuação permanece registrada. Conserve os documentos originais.

## Estado e publicação

No teste local, `.data/` guarda atividades e PDFs privados. Use um único processo do servidor para essa pasta. Na Vercel, a persistência usa Supabase; o app recusa armazenamento local nesse ambiente.

O caminho de publicação é GitHub Desktop → GitHub → Vercel. A configuração é manual: veja [docs/DEPLOY.md](docs/DEPLOY.md). Nenhum serviço é criado automaticamente. `.env`, dados e documentos reais estão ignorados pelo Git.

## Verificação

```powershell
npm test
npm run check
```

A suíte verifica autorização, PDFs, captura concorrente, defesa isolada, prazo, pontuação e persistência, além de 60 participantes em 20 equipes. Veja [docs/TESTE-EM-SALA.md](docs/TESTE-EM-SALA.md) para o ensaio em navegadores.

Atividades existentes são atualizadas automaticamente, preservando PDFs, capturas e pontos. Durante uma rodada, o antigo papel de analista passa a defensor; antes do início, esse integrante deve escolher uma das duas funções. Os detalhes novos por comando e por defensor são contados desde a atualização. Depois de publicar esta versão, os jogadores devem atualizar a página para carregar a interface compatível. Não há alteração no SQL do Supabase.

## Estrutura

- `index.html`, `style.css`, `js/arena.js`: interface, manual e treino.
- `lib/engine.mjs`: regras, sessões e pontuação.
- `lib/http.mjs`, `server.mjs`: API e servidor local.
- `lib/store.mjs`: persistência local ou Supabase com controle de revisão.
- `api/index.mjs`, `vercel.json`: entrada para Vercel.
- `supabase/setup.sql`: configuração inicial do banco e bucket privado.

Os arquivos JavaScript da versão anterior continuam na pasta `js/`, mas não são carregados pela nova arena.
