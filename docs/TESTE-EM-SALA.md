# Teste da arena antes da aula

Este roteiro verifica a atividade de ataque e defesa simulados com os PDFs da retrospectiva Fecart. O teste automático usa diretórios temporários, servidor HTTP local em porta livre e relógio controlado. A atividade e os arquivos usados nos testes não são os da turma.

## Verificação automática

Na raiz do projeto, execute:

```powershell
node --test tests/arena.test.mjs
```

Se o Node não estiver no PATH desta máquina, use o runtime disponível no Codex:

```powershell
& 'C:\Users\Rafael Rossetti\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests/arena.test.mjs
```

O resultado esperado é todos os testes passarem. A suíte verifica autorização de professor e papéis, grupos com diferentes quantidades de integrantes, PDFs de até 3 MiB, início condicionado à preparação de todos, privacidade, limites de invasões, captura concorrente sem pontos duplicados, defesas por incidente, download de uso único, encerramento, prorrogação, avisos e persistência. Também simula 60 participantes, 20 trios e ataques simultâneos sem perder integrantes ou pontuação. Esse teste valida concorrência funcional; não mede a capacidade da conexão Wi-Fi ou do equipamento da escola.

## Ensaio com navegadores

1. Inicie a aplicação conforme o README e abra o painel do professor. Crie uma atividade de teste e anote o código de entrada.
2. Use janelas ou perfis de navegador independentes para seis alunos fictícios. Cada perfil mantém sua própria sessão. Entre no mesmo código com nomes distintos.
3. No professor, forme dois trios. Não use o mesmo participante em dois grupos. Em cada trio, mantenha ao menos um atacante e um defensor; o terceiro reforça uma das funções.
4. Envie um PDF de teste para apenas um dos grupos e tente iniciar. O início deve ser recusado. Envie o segundo PDF, confirme a preparação de todos e inicie uma rodada curta.
5. Como atacante, selecione o outro grupo e siga descoberta, inspeção, acesso e extração, respeitando os intervalos de ação. A tentativa deve aparecer para o grupo que está defendendo.
6. Como defensor, selecione o incidente e aplique a defesa adequada: `reroute` na etapa Alvo reconhecido, `block` na etapa Pista encontrada e `revoke` na etapa Acesso obtido. Uma ferramenta fora de sua etapa deve falhar sem consumir carga. O resultado deve afetar apenas aquele incidente. Confira a reserva compartilhada de duas cargas, a recuperação de uma a cada oito segundos e o intervalo de cinco segundos por defensor, mesmo mudando de conexão.
7. Retome o ataque conforme o estado do incidente. Conclua a captura e baixe o PDF. Confira o arquivo e os 50 pontos de captura. Reutilizar o mesmo link de download deve falhar.
8. Envie um aviso e confira a janela central nos dois grupos. Confirme a leitura; atualizar a página não deve reabrir o mesmo aviso. Prorrogue a rodada e verifique a mudança do prazo. Envie um efeito a um grupo e confira que somente os seus integrantes recebem a interferência, com término automático e opção de reduzir o efeito.
9. Encerre manualmente. Cada grupo que preservou seu documento recebe 50 pontos uma única vez. Atualizar a página ou encerrar novamente não pode somar outro bônus.
10. Faça outra rodada curta e deixe o prazo terminar. Uma consulta ou ação após o prazo deve produzir o resultado final antes de aceitar qualquer nova pontuação.

Confira também:

- Clique em `scan` uma vez e execute. O botão deve continuar indisponível após atualizar a página; uma nova execução exige digitação. Tente um comando com erro e confira que não avança. Tente colar e arrastar texto no campo da rodada.
- Prepare o próximo comando durante o intervalo e segure Enter até o contador terminar. Nenhuma execução deve ficar na fila ou acontecer automaticamente. Solte Enter e pressione novamente: deve executar uma vez. Repita o teste na defesa, incluindo o Enter com foco no botão Executar.
- Use dois atacantes contra o mesmo grupo. Uma defesa deve afetar somente um deles. Use **Trocar alvo** e confira que a conexão do outro atacante permanece intacta.
- Crie um grupo com quatro ou mais integrantes. Todos devem ser selecionados e aparecer na equipe. Um grupo com apenas um integrante pode ser organizado, mas não pode iniciar sem atender aos papéis de ataque e defesa.
- Configure dois defensores na mesma equipe e execute respostas simultâneas. Eles devem compartilhar a reserva, sem gerar cargas ou pontos duplicados.
- Capture o mesmo PDF com duas equipes diferentes. O professor deve ver dois vazamentos e os nomes dessas equipes no detalhamento. Repetir a captura pela mesma equipe deve falhar.
- Consulte os comandos por integrante e as origens da pontuação no painel de métricas. A tela pública deve mostrar equipes e ranking, sem os nomes dos alunos.

## Ensaio com a turma

Para 60 alunos, forme 20 trios. Após a entrada e a definição dos papéis, confira se todos os grupos têm documento pronto antes de iniciar. Faça primeiro uma rodada de ensaio: os atacantes iniciam a descoberta ao mesmo tempo e os defensores acompanham as conexões e sua reserva. Distribua o terceiro integrante entre ataque e defesa e compare os resultados das duas estratégias.

Confira na projeção do professor se cada aluno entrou apenas no grupo previsto e se nenhuma ação desapareceu. Distribua os alvos para respeitar o limite de invasões simultâneas por grupo. Encerrar a rodada de ensaio permite verificar o placar antes da atividade avaliada.

Use os PDFs que o professor autorizar para a atividade. O aluno deve receber o documento de outro grupo apenas pela captura validada; a consulta pública deve mostrar o andamento coletivo sem expor nomes individuais, credenciais ou caminhos dos arquivos. Durante o ensaio, evite projetar a sessão privada de um aluno.

## Se algo falhar

- Participante não recebe atualizações: confirme o código da atividade e a sessão usada; consulte o estado novamente antes de repetir ações.
- Ataque ou defesa recusados: veja papel, estágio do incidente, prazo e intervalo entre ações. A recusa deve trazer uma mensagem útil.
- Início recusado: confira integrantes, presença de ataque e defesa e PDF pronto em todos os grupos.
- Download repetido recusado: o link é de uso único e tem validade curta; confira se o primeiro download já foi concluído.
- Teste automático falha: guarde o nome do teste e a mensagem de erro, corrija a causa e execute a suíte novamente antes de levar a versão para a aula.

Após o ensaio, revise as alterações no GitHub Desktop e registre a versão testada. Não inclua credenciais, sessões de alunos ou os PDFs da turma no commit.
