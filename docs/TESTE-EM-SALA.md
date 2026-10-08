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

O resultado esperado é todos os testes passarem. A suíte verifica autorização de professor e papéis, grupos com dois ou três integrantes, PDFs de até 3 MiB, início condicionado à preparação de todos, privacidade, limites de invasões, captura concorrente sem pontos duplicados, defesas por incidente, download de uso único, encerramento, prorrogação, avisos e persistência. Também simula 60 participantes, 20 trios e ataques simultâneos sem perder integrantes ou pontuação. Esse teste valida concorrência funcional; não mede a capacidade da conexão Wi-Fi ou do equipamento da escola.

## Ensaio com navegadores

1. Inicie a aplicação conforme o README e abra o painel do professor. Crie uma atividade de teste e anote o código de entrada.
2. Use janelas ou perfis de navegador independentes para seis alunos fictícios. Cada perfil mantém sua própria sessão. Entre no mesmo código com nomes distintos.
3. No professor, forme dois trios. Não use o mesmo participante em dois grupos. Em cada trio, um aluno escolhe ataque, outro defesa e outro análise.
4. Envie um PDF de teste para apenas um dos grupos e tente iniciar. O início deve ser recusado. Envie o segundo PDF, confirme a preparação de todos e inicie uma rodada curta.
5. Como atacante, selecione o outro grupo e siga descoberta, inspeção, acesso e extração, respeitando os intervalos de ação. A tentativa deve aparecer para o grupo que está defendendo.
6. Como defensor, selecione o incidente recebido e aplique uma defesa. O resultado deve afetar aquele incidente. Repetir a defesa sem uma nova ação ofensiva válida não pode aumentar a pontuação.
7. Retome o ataque conforme o estado do incidente. Conclua a captura e baixe o PDF. Confira o arquivo e os 50 pontos de captura. Reutilizar o mesmo link de download deve falhar.
8. Envie um aviso do professor e confira o recebimento nos dois grupos. Prorrogue a rodada e verifique a mudança do prazo em outras janelas.
9. Encerre manualmente. Cada grupo que preservou seu documento recebe 50 pontos uma única vez. Atualizar a página ou encerrar novamente não pode somar outro bônus.
10. Faça outra rodada curta e deixe o prazo terminar. Uma consulta ou ação após o prazo deve produzir o resultado final antes de aceitar qualquer nova pontuação.

## Ensaio com a turma

Para 60 alunos, forme 20 trios. Após a entrada e a definição dos papéis, confira se todos os grupos têm documento pronto antes de iniciar. Faça primeiro uma rodada de ensaio: os 20 atacantes iniciam a descoberta ao mesmo tempo, os defensores consultam os incidentes e os analistas acompanham os registros.

Confira na projeção do professor se cada aluno entrou apenas no grupo previsto e se nenhuma ação desapareceu. Distribua os alvos para respeitar o limite de invasões simultâneas por grupo. Encerrar a rodada de ensaio permite verificar o placar antes da atividade avaliada.

Use os PDFs que o professor autorizar para a atividade. O aluno deve receber o documento de outro grupo apenas pela captura validada; a consulta pública deve mostrar o andamento coletivo sem expor nomes individuais, credenciais ou caminhos dos arquivos. Durante o ensaio, evite projetar a sessão privada de um aluno.

## Se algo falhar

- Participante não recebe atualizações: confirme o código da atividade e a sessão usada; consulte o estado novamente antes de repetir ações.
- Ataque ou defesa recusados: veja papel, estágio do incidente, prazo e intervalo entre ações. A recusa deve trazer uma mensagem útil.
- Início recusado: confira integrantes, presença de ataque e defesa e PDF pronto em todos os grupos.
- Download repetido recusado: o link é de uso único e tem validade curta; confira se o primeiro download já foi concluído.
- Teste automático falha: guarde o nome do teste e a mensagem de erro, corrija a causa e execute a suíte novamente antes de levar a versão para a aula.

Após o ensaio, revise as alterações no GitHub Desktop e registre a versão testada. Não inclua credenciais, sessões de alunos ou os PDFs da turma no commit.
