# CLAUDE.md — Diagnóstico Psicossocial NR-1 (Cuidar+)

Contexto permanente deste repositório. Leia antes de mexer em qualquer coisa.

## O produto

Plataforma de diagnóstico psicossocial para conformidade com a **NR-1**, norma brasileira que
obriga o empregador a mapear riscos psicossociais no trabalho. Colaboradores respondem um
questionário anônimo em escala Likert 1–5; o sistema agrega por departamento, classifica cada
dimensão numa faixa de risco, emite alertas e acompanha eNPS. O mapa de risco resultante
alimenta o inventário de riscos do PGR.

Construído para a **Cuidar+** (empresa de performance e bem-estar), onde Mauro é fundador e
Head of Technology. Está em produção com clientes reais.

## Regras invioláveis

1. **Nunca apagar nem limpar nada no banco de produção.** Sem `DELETE`, sem `TRUNCATE`, sem
   "limpar dados de teste". Diagnósticos de outras empresas convivem no mesmo banco. Dados
   novos entram sempre como **nova empresa / novo diagnóstico**. Em dúvida, pergunte antes.
2. **Sempre `main`.** Sem branches, sem worktrees, sem PRs.
3. **Deploy é gate humano.** Só faça `git push` quando o Mauro pedir; o Railway faz deploy
   automático a partir do `main`, então push = deploy em produção.
4. Mudanças de schema também são gate humano — proponha e espere aprovação.

## Stack e deploy

- **Front**: React 18 + Vite + Recharts + Framer Motion. Tudo em `src/App.jsx` (~4.500 linhas,
  componente único) mais `src/api.js` (cliente HTTP) e `src/index.css`.
- **Back**: Node.js + Express em `server/`, PostgreSQL via `pg`, JWT + bcrypt, Resend para
  e-mail, `pdf-parse` para importar questionário de PDF.
- **Deploy**: Railway (nixpacks, `npm run build && npm start`, healthcheck em `/health`).
  Produção: https://diagnosticonr1-production.up.railway.app/
- **Repo**: `alchemistmao/diagnosticoNR1`, branch `main`.

### Arquivos

```
server/
  index.js                 Express, monta as rotas, initDatabase() e o seed da demo no boot
  database.js              pool pg, initDatabase() (cria/migra tabelas), template NR-1 padrão
  auth.js                  middleware authenticate / isAdmin
  email.js                 Resend (convite, reset de senha)
  seed-demo-logtech.js     dados de demonstração (ver abaixo)
  routes/
    auth.js                login, reset de senha
    users.js               CRUD de usuários
    departments.js         CRUD de departamentos
    diagnostics.js         diagnósticos, dimensões, perguntas, importação de PDF, matrícula
    responses.js           submissão de respostas, estatísticas, alertas de risco, export CSV
src/
  App.jsx                  app inteiro (login, questionário, painel admin, dashboards)
  api.js                   cliente da API
  index.css                estilos
```

### Tabelas

`diagnostics` → `dimensions` → `questions`; `departments` (por diagnóstico); `users`;
`responses` (guarda `answers` e `open_answers` como JSONB); `user_diagnostics` (matrícula);
`user_diagnostics_access` (quais diagnósticos cada usuário RH enxerga);
`password_reset_tokens`.

### Variáveis de ambiente

`DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY`, `APP_URL`, `FROM_EMAIL`, `PORT`.

## Conceitos do domínio

- **Dimensões** (template NR-1 padrão): Organização e Carga de Trabalho, Clareza de Papéis,
  Liderança e Suporte, Relações Interpessoais, Segurança Psicológica, Reconhecimento e Justiça,
  Saúde Mental, Apoio Organizacional. Mais perguntas abertas.
- **Perguntas invertidas** (`questions.inverted`): concordar indica algo negativo; a nota é
  normalizada como `6 - valor`.
- **Faixas de risco** (média 1–5): `< 2.5` Crítico · `2.5–2.9` Alto Risco · `3.0–3.4` Risco
  Moderado · `3.5–4.1` Neutro · `≥ 4.2` Engajado.
- **O departamento é o escolhido no momento da resposta** (`responses.department_id`), não o
  cadastro atual do usuário. A pesquisa é anônima e o respondente seleciona a área ao
  responder. Já houve um bug em que `/stats` sobrescrevia isso por `users.department_id` e
  jogava 52 de 62 respostas num único departamento; não reintroduza.
- **Anonimato**: nunca exponha resposta individual ligada a pessoa. O mínimo prático por área
  é 5 respondentes; a UI já esconde recortes pequenos demais.

## Demo "LogTech"

`server/seed-demo-logtech.js` cria um diagnóstico de demonstração de uma empresa fictícia de
logística reversa (80 colaboradores, 7 departamentos, 28 perguntas, 100% de resposta, perfil
de risco calibrado e respostas abertas em linguagem de chão de fábrica). Serve para
apresentações comerciais.

É **somente INSERT**, transacional e **idempotente**: roda no boot do servidor e, se o
diagnóstico já existir, não faz nada. Também roda sozinho:
`node server/seed-demo-logtech.js --dry-run` e sem `--dry-run`.
Se for evoluir a demo, mantenha essas três propriedades.

## Como o Mauro trabalha

- Conversa em **português**; código, UI e commits em **inglês**.
- Uma instrução por vez, sem blocos com várias coisas. Sempre diga para quem é cada instrução.
- Comandos de terminal em uma linha só, prontos para colar.
- Respostas concisas, sem enrolação. Uma pergunta por vez.
- Entregas completas e autocontidas, não fragmentos incrementais.
- Automação máxima, com aprovação humana nos pontos que custam dinheiro, mudam schema ou
  fazem deploy.
- Sempre termine a resposta com a URL relevante na última linha, para ele clicar.

## Antes de commitar

`npm run build` tem que passar. Não commite `package-lock.json` alterado por instalação local
sem motivo.
