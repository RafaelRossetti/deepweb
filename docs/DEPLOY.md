# Testar e publicar a arena

## Teste local

Use Node.js 24. Na pasta do projeto, copie `.env.example` para `.env`, defina uma senha própria em `TEACHER_PASSWORD` e execute:

```powershell
npm start
```

Abra `http://localhost:3000`. Outros computadores da mesma rede podem usar `http://IP-DO-PROFESSOR:3000` enquanto o servidor estiver em execução e a rede permitir a conexão. O endereço `localhost` funciona apenas no próprio computador. Se o Windows pedir acesso à rede, permita somente a rede privada do laboratório.

Sem variáveis do Supabase, o servidor salva atividades em `.data/activities` e PDFs em `.data/documents`. Reiniciar o servidor preserva os dados. `THOR_DATA_DIR` pode apontar para outra pasta de dados. Execute um único processo do servidor sobre a mesma pasta local; o controle de ações simultâneas é feito por atividade nesse processo. Nenhum PDF deve ficar na pasta pública do site.

## Supabase

Você fará a criação manualmente. Nenhum projeto ou serviço foi criado por esta versão.

1. Entre em [supabase.com/dashboard](https://supabase.com/dashboard) e clique em **New project**.
2. Escolha sua organização, use o nome **deepweb-arena** e escolha a região de **São Paulo / South America**, se disponível. Confira o plano e o custo apresentado antes de criar.
3. Gere uma senha forte para o banco e guarde-a no seu gerenciador de senhas. Essa senha não é a senha do professor nem a secret key da API.
4. Crie o projeto e aguarde a inicialização. Abra **SQL Editor → New query**.
5. Copie o conteúdo de `supabase/setup.sql`, revise e execute. Ele cria `public.thor_activities` e o bucket privado `thor-documents`.
6. Confira os resultados ao final do SQL: `public=false`, limite `3145728`, MIME `application/pdf` e RLS ativado na tabela.
7. Em **Connect** ou nas configurações do projeto, obtenha a URL base e uma **secret key** que começa com `sb_secret_`. Não envie essa chave pelo chat.
8. Configure `SUPABASE_URL` e `SUPABASE_SECRET_KEY` no ambiente do servidor. Para testar localmente, copie `.env.example` para `.env` e preencha essas duas variáveis, além de `TEACHER_PASSWORD` com a senha que você usará na tela do professor.
9. Reinicie com `npm start`. Abra uma atividade de teste, envie um PDF de demonstração e percorra o fluxo de captura para verificar o armazenamento.

A chave secreta fica apenas no servidor. O navegador não precisa de uma chave do Supabase: usa a API da arena. A tabela tem RLS e não concede acesso aos papéis `anon` e `authenticated`. Os buckets e objetos têm políticas restritivas para impedir que outras políticas amplas abram o bucket da atividade. O backend valida as sessões e usa a chave de servidor para cada operação.

O projeto aceita provisoriamente uma chave legada `service_role` por `SUPABASE_SERVICE_ROLE_KEY`, mas a configuração recomendada é `SUPABASE_SECRET_KEY`. Nunca use uma chave `anon` ou `publishable` como chave de servidor. [Documentação oficial de chaves](https://supabase.com/docs/guides/getting-started/api-keys), [segurança da Data API](https://supabase.com/docs/guides/api/securing-your-api) e [controle de acesso do Storage](https://supabase.com/docs/guides/storage/security/access-control).

## GitHub Desktop e GitHub

Adicione a pasta existente no GitHub Desktop, revise a lista de alterações e faça o commit. Confira que `.env`, `.data`, PDFs reais e arquivos temporários estão ignorados antes de enviar o código. Faça **Push origin** para o remoto do projeto e confirme o repositório no GitHub.com. Os documentos dos alunos ficam no armazenamento privado, fora do Git.

## Vercel

Importe o repositório do GitHub na Vercel. Use o projeto como aplicação Node.js com o arquivo `vercel.json` do repositório; não publique somente o HTML estático. Selecione Node.js 24 nas configurações e defina as variáveis de ambiente para o ambiente que receberá a turma:

| Variável | Valor |
| --- | --- |
| `TEACHER_PASSWORD` | Senha própria do professor |
| `SUPABASE_URL` | URL base do projeto Supabase escolhido |
| `SUPABASE_SECRET_KEY` | Secret key exclusiva para o backend |

Republique após alterar as variáveis. Sem Supabase configurado, a aplicação recusa iniciar na Vercel: o filesystem das funções não é armazenamento persistente. Se usar Preview Deployments, configure essas variáveis também em Preview e mantenha o acesso ao teste sob seu controle. [Runtimes Node.js](https://vercel.com/docs/functions/runtimes/node-js) e [variáveis de ambiente](https://vercel.com/docs/environment-variables).

Cada PDF deve ter no máximo **3 MiB**. O upload JSON usa base64, aumentando o corpo da requisição; esse limite reserva margem abaixo dos 4,5 MB aceitos pelas funções Vercel. [Limites das funções](https://vercel.com/docs/functions/limitations#request-body-size).

## Conferência antes da aula

Abra a aplicação em três navegadores ou perfis: professor e dois alunos. Monte duas equipes com pelo menos um atacante e um defensor em cada; envie os PDFs; escolha os papéis; inicie por um minuto. Teste um ataque, uma defesa direcionada, um alerta, acréscimo de tempo e encerramento. Confira o ranking e que uma equipe não captura ou pontua duas vezes pelo mesmo documento de outra equipe. Depois faça um teste com os computadores do laboratório para conferir rede e latência.

O estado é persistido com um número de revisão. A API repete operações quando uma revisão foi alterada por outra ação: a atualização condicional do banco impede que duas requisições sobrescrevam pontuação ou participantes. O armazenamento em nuvem está preparado no código, mas só fica verificado de ponta a ponta após configurar e testar o projeto Supabase escolhido. Esta primeira versão usa consultas periódicas à API; não exige Supabase Realtime.
