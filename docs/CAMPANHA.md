# Campanha das Chaves

Este é o modo padrão das novas atividades. O professor pode escolher **Captura de PDFs** para usar a dinâmica original. Atividades anteriores continuam no modo original, com documentos, pontos, funções e histórico preservados.

## Preparação

Crie pelo menos duas equipes, com qualquer quantidade de integrantes dentro do limite de 60 participantes/20 equipes. Na campanha, todos podem atacar e defender, inclusive uma pessoa sozinha por equipe. Não há seleção obrigatória de funções. Libere a preparação, deixe a turma estudar as ferramentas e inicie com a duração desejada.

Os PDFs dos grupos são opcionais. Se houver upload, a primeira captura da chave daquele grupo permite baixar o arquivo, como na dinâmica original. O dossiê do Pentágono é gerado automaticamente pelo servidor; não exige upload nem configuração adicional.

## Disputa pelas chaves

Cada equipe começa com sua chave original. Cada chave tem um único cofre atual. Os jogadores escolhem **a chave**; a interface mostra em qual equipe ela está. É possível conquistar uma chave que já foi roubada por outro grupo, atacando seu portador atual.

O ciclo continua sendo `scan` → `inspect` → `access` → `extract`. Para recuperar a própria chave, termine com `recover`. Uma transferência invalida conexões que ainda estavam investigando a localização anterior. Trocar de alvo encerra somente a investigação daquele integrante.

Na campanha, uma conexão sem ação de ataque ou defesa por 45 segundos é encerrada, liberando a vaga para outras equipes e para a Interpol. A proteção evita que jogadores ausentes ocupem todas as vagas indefinidamente.

Todos têm ataque e defesa disponíveis. O intervalo por jogador é compartilhado entre os painéis: 4 segundos após ataque/comando de missão, 5 após defesa e 1 após consulta de logs. A reserva de defesa do cofre continua compartilhada: duas cargas, uma recuperada a cada oito segundos. Comandos de missão exigem digitação; colagem e arraste permanecem bloqueados. Enter repetido ou mantido durante o intervalo não guarda uma execução.

## Dossiê e brute force guiada

Ao reunir **todas as chaves atuais, incluindo a original**, todos os integrantes recebem acesso ao desafio do PDF bloqueado. A Interpol também é mobilizada. O selo do conjunto depende das chaves e de suas versões; ele muda quando uma chave é perdida e recapturada.

Os alunos identificam a máscara correta pela pista e digitam `bruteforce --mask MÁSCARA --keys SELO`. A máscara `?d?d?d?d` representa quatro dígitos. A busca simula 10.000 combinações durante 20 segundos no servidor. A equipe pode continuar atacando e defendendo nesse período.

A perda de uma chave interrompe a busca. É preciso recuperar o conjunto e iniciar uma nova tentativa. Ao concluir, cada integrante pode baixar um PDF real com o código do Pentágono. O PDF é comum, sem senha externa: o bloqueio e a brute force são mecanismos didáticos da arena. O código não é enviado nos snapshots nem exibido na tela pública.

## Interpol

A Interpol é um bot de regras, executado pelo servidor. Não exige um serviço de IA externo nem processos em segundo plano. O avanço é calculado durante as requisições, inclusive no ambiente serverless da Vercel.

A onda usa uma das vagas de ataque simultâneo da equipe. Se todas estiverem ocupadas, aguarda uma vaga. Cada onda tem três investidas, com etapa e IP de origem nos logs. É necessário digitar a ferramenta adequada **com o IP**: `reroute IP`, `block IP` ou `revoke IP`. Uma resposta afeta apenas essa conexão e usa a reserva de defesa normal. Após a resposta, a próxima investida vem em oito segundos.

Três respostas corretas vencem a onda. A próxima chega depois de 20 segundos. Se o prazo de uma investida vencer, a Interpol devolve uma chave adversária ao dono original, se houver, e volta em 30 segundos. Devolução automática não rende pontos de resgate.

O professor escolhe a dificuldade ao criar a atividade ou em **Interpol e Pentágono**. Pode também ativar a Interpol manualmente para um grupo. Alterar a dificuldade preserva prazos que já começaram.

| Dificuldade | Prazo da Interpol | Prazo do Pentágono |
| --- | --- | --- |
| Treino | 18 s | 16 s |
| Equilibrado | 14 s | 12 s |
| Desafio | 11 s | 9 s |

## Pentágono cooperativo

Um integrante abre a missão do time com `connect CÓDIGO`, usando o código encontrado no PDF. Todos os integrantes do grupo recebem um desafio individual, com endereço, porta e credencial próprios. A sequência de cada pessoa é:

1. `scan IP` e neutralizar o reconhecimento da IA com `reroute ORIGEM`.
2. `inspect PORTA` e neutralizar a pista da IA com `block ORIGEM`.
3. `access CREDENCIAL` e neutralizar o acesso da IA com `revoke ORIGEM`.
4. `extract master`.

Os argumentos são descobertos nos logs da estação. Defesas do Pentágono usam o intervalo do próprio integrante, sem consumir a reserva compartilhada do cofre; cada pessoa enfrenta seu próprio contra-ataque. Isso permite que grupos grandes também concluam o desafio. A Interpol e os rivais continuam atacando o cofre normalmente.

Uma resposta errada não avança e impõe três segundos de espera. Perder o prazo volta uma etapa e impõe cinco segundos para tentar novamente. A perda de qualquer chave pausa o avanço de toda a equipe. Recuperar o conjunto retoma a missão, preservando quem já concluiu e dando um novo prazo às ameaças suspensas.

A bandeira mestra só é conquistada quando **todos os integrantes** terminam. Vale uma vez por equipe. A rodada continua até o prazo ou o encerramento pelo professor; a equipe pode continuar defendendo suas chaves e enfrentando ondas da Interpol.

## Pontos

| Evento | Prêmio |
| --- | --- |
| Primeira captura da chave de cada adversário | 50 |
| Primeiro resgate da própria chave contra cada portador adversário | 50 |
| Defesa válida de conexão humana ou da Interpol | 5 |
| Onda da Interpol vencida, além das defesas | 25 |
| Cada minuto contínuo com a própria chave em casa | 5 |
| Bandeira mestra, uma vez por equipe | 200 |
| Própria chave em casa ao encerrar | 50 |

Capturas e resgates repetidos continuam mudando a posse, mas não repetem os prêmios de 50 contra o mesmo rival. Consultas de logs, respostas inválidas e as respostas individuais do Pentágono não rendem pontos isolados. O histórico de vazamentos é preservado; um PDF já baixado não pode ser removido do computador de outro aluno pelo jogo.

O professor acompanha chaves atuais, resgates, comandos por integrante, pontos por origem, ondas vencidas e quantos integrantes concluíram o final. O ranking público mostra os resultados das equipes, sem nomes individuais, pistas privadas ou códigos.

O histórico técnico guarda as conexões recentes, enquanto contadores e registros de prêmios preservam os totais da atividade. Repetir capturas não cria um registro de prêmio novo: a quantidade e a data da última disputa ficam no mesmo registro por par de equipes.

## Publicação e validação

Não há migração de SQL nem variáveis novas no Supabase. A campanha usa a mesma persistência de estado com controle de revisão. PDFs gerados são entregues mediante sessão autorizada, sem endereço público no Storage.

Execute `npm test` e `npm run check`. A suíte cobre os dois modos, 60 participantes/20 equipes, posse exclusiva, capturas concorrentes, limites de pontos, comandos compartilhados, perda de chaves, prazos, cooperação obrigatória e privacidade do dossiê. Após publicar, os participantes devem atualizar a página. Abra uma **nova atividade** para testar a campanha; uma atividade anterior permanece na dinâmica original.
