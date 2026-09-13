/**
 * Demo data seeder — "LogTech" (fictional reverse-logistics company, 80 employees)
 *
 * INSERT-ONLY. This script never deletes or updates existing rows.
 * It creates: 1 diagnostic, 10 dimensions, 29 questions (26 Likert + 1 eNPS + 2 open), 7 departments,
 * 80 users (role 'user'), 80 enrollments, 80 responses (100% response rate),
 * and grants access to the new diagnostic for every existing RH user.
 *
 * Two ways to run it:
 *   1. Automatically at server startup (see server/index.js) — idempotent, so it only
 *      seeds once; every later boot finds the diagnostic and does nothing.
 *   2. Standalone, with DATABASE_URL set:
 *        node server/seed-demo-logtech.js            # runs the seed
 *        node server/seed-demo-logtech.js --dry-run  # prints the plan, writes nothing
 *
 * Re-running is safe: if a diagnostic with the same name already exists, the seeder only applies
 * pending upgrades to that dataset (department renames, missing eNPS — see upgradeExisting) and
 * otherwise changes nothing.
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// ------------------------------------------------------------------
// Deterministic RNG (mulberry32) so the demo is reproducible
// ------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260913);
const randn = () => {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ------------------------------------------------------------------
// Diagnostic definition
// ------------------------------------------------------------------
const DIAGNOSTIC = {
  name: 'LogTech — Diagnóstico Psicossocial NR-1',
  description:
    'Empresa fictícia de logística reversa (triagem, reparo e recondicionamento de equipamentos eletrônicos), 80 colaboradores em Campinas/SP. Dados de demonstração gerados a partir de um cenário realista: turnover alto, ausência de processos padronizados e cultura de feedback incipiente.',
  status: 'active',
  is_nr1: true,
};

const ENPS_QUESTION_TEXT =
  'Em uma escala de 0 a 10, o quanto você recomendaria a LogTech como um lugar para trabalhar a um amigo ou familiar?';

// Same 26 Likert items used by the app's built-in NR-1 template, plus 1 eNPS (0-10) and 2 open questions.
const DIMENSIONS = [
  {
    key: 'org',
    name: 'Organização e Carga de Trabalho',
    questions: [
      { text: 'Consigo realizar minhas tarefas dentro do horário de trabalho.', inverted: false },
      { text: 'Frequentemente preciso trabalhar em ritmo acelerado para dar conta das demandas.', inverted: true },
      { text: 'Tenho autonomia para decidir como realizar minhas atividades.', inverted: false },
      { text: 'O volume de trabalho é compatível com minha jornada.', inverted: false },
    ],
  },
  {
    key: 'clar',
    name: 'Clareza de Papéis',
    questions: [
      { text: 'Sei exatamente o que é esperado de mim no trabalho.', inverted: false },
      { text: 'Minhas responsabilidades são bem definidas.', inverted: false },
      { text: 'Recebo informações claras sobre mudanças que afetam meu trabalho.', inverted: false },
      { text: 'Entendo como meu trabalho contribui para os objetivos da empresa.', inverted: false },
    ],
  },
  {
    key: 'lid',
    name: 'Liderança e Suporte',
    questions: [
      { text: 'Meu gestor me trata com respeito.', inverted: false },
      { text: 'Posso contar com apoio do meu gestor quando preciso.', inverted: false },
      { text: 'Recebo feedback construtivo sobre meu desempenho.', inverted: false },
    ],
  },
  {
    key: 'rel',
    name: 'Relações Interpessoais',
    questions: [
      { text: 'Existe colaboração entre os colegas da minha equipe.', inverted: false },
      { text: 'O ambiente de trabalho é respeitoso e livre de conflitos frequentes.', inverted: false },
      { text: 'Sinto que faço parte de um time.', inverted: false },
    ],
  },
  {
    key: 'seg',
    name: 'Segurança Psicológica',
    questions: [
      { text: 'Me sinto seguro para expressar opiniões no trabalho.', inverted: false },
      { text: 'Posso cometer erros sem medo de punição desproporcional.', inverted: false },
      { text: 'Sinto que posso ser eu mesmo no ambiente de trabalho.', inverted: false },
    ],
  },
  {
    key: 'rec',
    name: 'Reconhecimento e Justiça',
    questions: [
      { text: 'Sinto que meu trabalho é reconhecido.', inverted: false },
      { text: 'As decisões que me afetam são tomadas de forma justa.', inverted: false },
      { text: 'Tenho oportunidades de crescimento na empresa.', inverted: false },
    ],
  },
  {
    key: 'sau',
    name: 'Saúde Mental',
    questions: [
      { text: 'Tenho me sentido ansioso ou preocupado com frequência por causa do trabalho.', inverted: true },
      { text: 'Tenho tido dificuldade para dormir por questões relacionadas ao trabalho.', inverted: true },
      { text: 'Me sinto emocionalmente esgotado ao final do dia de trabalho.', inverted: true },
    ],
  },
  {
    key: 'apo',
    name: 'Apoio Organizacional',
    questions: [
      { text: 'A empresa demonstra preocupação genuína com o bem-estar dos colaboradores.', inverted: false },
      { text: 'Tenho acesso a recursos ou programas de apoio à saúde mental.', inverted: false },
      { text: 'Confio que a empresa tomará medidas se eu reportar um problema.', inverted: false },
    ],
  },
  {
    key: 'enps',
    name: 'eNPS',
    questions: [
      { text: ENPS_QUESTION_TEXT, type: 'nps' },
    ],
  },
  {
    key: 'open',
    name: 'Percepções Abertas',
    questions: [
      { text: 'Na sua opinião, quais fatores no trabalho mais impactam o bem-estar das pessoas na empresa?', type: 'open', required: false },
      { text: 'O que poderia ser feito para melhorar a saúde mental no ambiente de trabalho?', type: 'open', required: false },
    ],
  },
];

// ------------------------------------------------------------------
// Departments: headcount + sentiment profile
// base: overall sentiment (-1 .. +1); dims: per-dimension override added on top
// openRate: probability that a respondent fills the open questions
// ------------------------------------------------------------------
const DEPARTMENTS = [
  {
    name: 'Triagem Técnica', headcount: 18, base: -0.55, openRate: 0.6,
    dims: { org: -0.35, sau: -0.35, lid: -0.3, seg: -0.25, rel: 0.15 },
  },
  {
    name: 'Laboratório de Reparo', headcount: 16, base: -0.15, openRate: 0.4,
    dims: { clar: -0.4, lid: -0.25, rel: 0.2, sau: 0.05 },
  },
  {
    name: 'Produção', headcount: 10, base: 0.0, openRate: 0.35,
    dims: { clar: -0.15, rel: 0.25, org: 0.1 },
  },
  {
    name: 'Expedição / Fulfillment', headcount: 12, base: -0.6, openRate: 0.6,
    dims: { org: -0.4, sau: -0.3, lid: -0.35, seg: -0.3, rec: -0.1 },
  },
  {
    name: 'Recebimento e Logística', headcount: 8, base: -0.2, openRate: 0.45,
    dims: { rel: -0.6, lid: -0.3, seg: -0.15 },
  },
  {
    name: 'Qualidade', headcount: 6, base: 0.35, openRate: 0.3,
    dims: { lid: 0.45, clar: 0.2, rec: 0.1 },
  },
  {
    name: 'Administrativo', headcount: 10, base: 0.45, openRate: 0.3,
    dims: { lid: 0.4, rel: 0.2, org: 0.1, sau: 0.15 },
  },
];

// Departments renamed after the first production seed (old name → new name).
// upgradeExisting() applies these to datasets that were seeded with the old name.
const RENAMED_DEPARTMENTS = {
  'Cosmética e Recondicionamento': 'Produção',
};

// Company-wide dimension sentiment (transversal issues)
const DIM_SENTIMENT = {
  org: -0.15,
  clar: -0.3,
  lid: -0.1,
  rel: 0.1,
  seg: -0.2,
  rec: -0.5,
  sau: -0.25,
  apo: -0.55,
};

// ------------------------------------------------------------------
// Open answers (Brazilian shop-floor voice). Keyed by department name.
// q1 = factors impacting wellbeing, q2 = what could improve
// ------------------------------------------------------------------
const OPEN_ANSWERS = {
  'Triagem Técnica': {
    q1: [
      'A meta de peças por hora não considera quando chega lote sem etiqueta ou com equipamento danificado. A gente corre o dia inteiro e ainda ouve que está devagar.',
      'Pressão por volume. Todo dia é urgência, todo dia é "tem que sair hoje". Não tem um dia normal.',
      'Ninguém ensina direito o processo. Você aprende errando e depois leva bronca pelo erro.',
      'Falta reconhecimento. Quando a triagem bate a meta ninguém fala nada, quando atrasa todo mundo vem cobrar.',
      'O barulho e o calor no galpão à tarde cansam muito, e a pausa é curta.',
      'Muita gente entrando e saindo. Toda semana tem gente nova e a gente que está há mais tempo tem que carregar.',
      'A cobrança vem de mais de uma pessoa ao mesmo tempo, cada um pedindo uma coisa diferente.',
    ],
    q2: [
      'Ter um treinamento de verdade para quem entra, com alguém acompanhando na primeira semana.',
      'Meta que leve em conta o tipo de lote. Lote de modem antigo não rende igual lote de set-top box novo.',
      'Mais gente na triagem nos dias de pico ou avisar com antecedência quando vai chegar volume grande.',
      'O gestor sentar com a equipe uma vez por semana para ouvir, não só para cobrar.',
      'Uma pausa a mais no meio da tarde.',
      'Padronizar o processo por escrito, com foto, para não depender de perguntar para o colega.',
    ],
  },
  'Laboratório de Reparo': {
    q1: [
      'Cada técnico faz de um jeito porque não existe procedimento escrito. Quando dá problema, a culpa cai em quem estava no bancada.',
      'Não sei se estou indo bem ou mal. Feedback só aparece quando alguma coisa dá errado.',
      'Falta peça e ferramenta e a cobrança pelo prazo continua a mesma.',
      'Reprova no teste final é alta e ninguém para pra entender o porquê, só manda refazer.',
      'Os colegas ajudam bastante, isso segura a gente aqui.',
    ],
    q2: [
      'Procedimento padrão de reparo por modelo, escrito e revisado com a equipe.',
      'Conversa individual com o supervisor pelo menos uma vez por mês.',
      'Treinamento técnico contínuo, não só quando entra equipamento novo.',
      'Um plano de carreira claro para técnico. Hoje não sei o que preciso fazer para crescer.',
      'Melhorar o estoque de peças para não ficar parado esperando.',
    ],
  },
  'Produção': {
    q1: [
      'O trabalho é repetitivo e no fim do dia o braço e as costas doem. Não tem ginástica laboral nem rodízio.',
      'Quando muda o padrão de acabamento ninguém avisa antes, a gente descobre quando o lote volta.',
      'A equipe é unida, o problema é a falta de informação de cima.',
      'Produtos químicos de limpeza sem orientação clara de uso.',
    ],
    q2: [
      'Rodízio de tarefas e pausas para alongamento.',
      'Comunicar as mudanças de padrão antes de começar o lote.',
      'Reconhecer a equipe quando o índice de retrabalho cai.',
    ],
  },
  'Expedição / Fulfillment': {
    q1: [
      'Fim de mês é desumano. Transportadora esperando, sistema travando e a chefia gritando no galpão.',
      'Horas extras quase toda semana e ainda assim é como se nunca fosse suficiente.',
      'Medo de falar. Quem reclama vira alvo, então todo mundo fica quieto.',
      'Erro de separação é tratado como se fosse má vontade, não como falha de processo.',
      'Chego em casa sem energia para nada. Já tive colega que saiu de atestado por causa disso.',
      'Falta de respeito na forma de cobrar. Pode cobrar, mas não precisa humilhar.',
      'A gente não sabe o que vai chegar até o caminhão estar na doca.',
    ],
    q2: [
      'Planejamento de carga com antecedência para a expedição não descobrir o volume na hora.',
      'Trocar o jeito de cobrar. Cobrar o processo, não a pessoa na frente de todo mundo.',
      'Um canal para reportar problema sem medo de retaliação.',
      'Reforço de equipe no fechamento do mês em vez de hora extra obrigatória.',
      'Treinar o líder para lidar com pessoas, não só com número.',
      'Reconhecer quando a equipe vira a noite para entregar. Um obrigado já ajudaria.',
    ],
  },
  'Recebimento e Logística': {
    q1: [
      'Conflito constante entre recebimento e triagem por causa de lote mal conferido. Vira briga pessoal.',
      'O supervisor não resolve os atritos, deixa a coisa rolar até explodir.',
      'Cada um puxa para um lado, não parece um time.',
      'Falta clareza de quem é responsável pelo quê quando a nota fiscal vem errada.',
    ],
    q2: [
      'Mediação de conflitos com alguém de fora da área, e regra clara de conferência.',
      'Reunião curta entre recebimento e triagem toda manhã para alinhar o dia.',
      'Definir por escrito as responsabilidades de cada função.',
    ],
  },
  'Qualidade': {
    q1: [
      'Somos poucos para o volume de auditoria e a pressão para liberar lote rápido vem de todos os lados.',
      'Quando barramos um lote, a produção leva para o lado pessoal.',
      'Nossa gestora escuta e defende a equipe, isso faz diferença.',
    ],
    q2: [
      'Mais autonomia formal para a qualidade barrar lote sem precisar justificar para três pessoas.',
      'Levar os dados de reprova para a produção de forma educativa, não punitiva.',
    ],
  },
  'Administrativo': {
    q1: [
      'Aqui no escritório o clima é bom, mas vemos o desgaste do pessoal do galpão e isso pesa.',
      'Acúmulo de função: RH, financeiro e compras nas mesmas pessoas.',
      'Turnover alto gera retrabalho enorme em admissão e demissão.',
    ],
    q2: [
      'Programa de apoio psicológico para toda a empresa, não só para quem pede.',
      'Investir em onboarding estruturado para reduzir a rotatividade.',
      'Treinar os líderes de produção em gestão de pessoas.',
    ],
  },
};

// ------------------------------------------------------------------
// Names
// ------------------------------------------------------------------
const FIRST_NAMES = [
  'Ana', 'Maria', 'João', 'Pedro', 'Lucas', 'Gabriel', 'Rafael', 'Bruno', 'Carlos', 'Daniel',
  'Felipe', 'Gustavo', 'Henrique', 'Igor', 'Julia', 'Larissa', 'Mariana', 'Natalia', 'Patricia', 'Renata',
  'Sergio', 'Thiago', 'Vanessa', 'William', 'Amanda', 'Beatriz', 'Camila', 'Diego', 'Eduardo', 'Fernanda',
  'Jessica', 'Leandro', 'Marcelo', 'Priscila', 'Rodrigo', 'Simone', 'Tatiane', 'Vinicius', 'Adriana', 'Anderson',
  'Cristiane', 'Douglas', 'Elaine', 'Fabio', 'Gisele', 'Jefferson', 'Kelly', 'Luciana', 'Marcos', 'Roberta',
];
const LAST_NAMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes',
  'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa',
  'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas',
  'Cardoso', 'Ramos', 'Gonçalves', 'Santana', 'Teixeira', 'Araujo', 'Batista', 'Correia', 'Cunha', 'Pinto',
];
const EMAIL_DOMAIN = 'logtech.teste';
const DEMO_PASSWORD = 'teste123';

// ------------------------------------------------------------------
// Submission dates: 12 business days, Aug 26 → Sep 11, 2026 (skipping Sep 7 holiday)
// Front-loaded: most people answer in the first days after the launch.
// ------------------------------------------------------------------
const BUSINESS_DAYS = [
  '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31',
  '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
  '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
];
const DAY_WEIGHTS = [18, 15, 12, 10, 8, 7, 6, 6, 5, 5, 4, 4];

function randomSubmissionDate() {
  const total = DAY_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  let idx = 0;
  for (; idx < DAY_WEIGHTS.length; idx++) {
    r -= DAY_WEIGHTS[idx];
    if (r <= 0) break;
  }
  const day = BUSINESS_DAYS[Math.min(idx, BUSINESS_DAYS.length - 1)];
  // Working hours 07:30–17:30 (America/Sao_Paulo, UTC-3)
  const minutes = 450 + Math.floor(rand() * 600);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const ss = String(Math.floor(rand() * 60)).padStart(2, '0');
  return `${day}T${hh}:${mm}:${ss}-03:00`;
}

// ------------------------------------------------------------------
// Answer generation
// ------------------------------------------------------------------
function likertFor(sentiment, personal) {
  // sentiment in roughly [-1.5, 1.5] → mean in [1.3, 4.7]
  const mean = clamp(3.55 + 1.0 * sentiment + personal, 1.3, 4.7);
  const v = mean + randn() * 0.75;
  return clamp(Math.round(v), 1, 5);
}

// eNPS (0-10), derived from each person's own Likert answers so it is consistent with the
// rest of their response. It uses a separate RNG stream so adding it does not change the
// Likert values produced by the main stream (fresh seeds stay identical to the first one).
const enpsRand = mulberry32(20260914);
const DETRACTOR_VALUES = [1, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6];

function enpsFor(answers, likertQuestions) {
  let sum = 0, n = 0;
  for (const q of likertQuestions) {
    const v = answers[q.id];
    if (v === undefined || v === null) continue;
    sum += q.inverted ? 6 - v : v; // flip negative statements so higher = better
    n++;
  }
  const mean = n > 0 ? sum / n : 3;
  // mean 1.5 → -1, 3 → 0, 4.5 → +1, plus a little individual noise
  const s = clamp((mean - 3) / 1.5 + (enpsRand() - 0.5) * 0.4, -1, 1);
  const detractorProb = 0.40 - 0.25 * s; // 65% .. 15%
  const neutralProb = 0.30 - 0.05 * s;   // 35% .. 25%
  const r = enpsRand();
  if (r < detractorProb) return DETRACTOR_VALUES[Math.floor(enpsRand() * DETRACTOR_VALUES.length)];
  if (r < detractorProb + neutralProb) return 7 + Math.floor(enpsRand() * 2);
  return 9 + Math.floor(enpsRand() * 2);
}

function enpsSummary(values) {
  const total = values.length;
  if (total === 0) return { score: null, promoters: 0, neutrals: 0, detractors: 0 };
  const promoters = values.filter((v) => v >= 9).length;
  const detractors = values.filter((v) => v <= 6).length;
  const neutrals = total - promoters - detractors;
  return {
    score: Math.round(((promoters - detractors) / total) * 100),
    promoters: Math.round((promoters / total) * 100),
    neutrals: Math.round((neutrals / total) * 100),
    detractors: Math.round((detractors / total) * 100),
  };
}

function buildResponse(dept, questionsByDim) {
  const personal = randn() * 0.4;
  const answers = {};
  const openAnswers = {};

  for (const dim of DIMENSIONS) {
    const qs = questionsByDim[dim.key];
    if (dim.key === 'open' || dim.key === 'enps') continue;
    const sentiment = dept.base + (DIM_SENTIMENT[dim.key] || 0) + (dept.dims[dim.key] || 0);
    for (const q of qs) {
      let value = likertFor(sentiment, personal);
      if (q.inverted) value = 6 - value; // agreement with a negative statement
      answers[q.id] = value;
    }
  }

  const likertQuestions = Object.values(questionsByDim).flat().filter((q) => q.type === 'likert5');
  for (const q of questionsByDim.enps) answers[q.id] = enpsFor(answers, likertQuestions);

  return { answers, openAnswers, personal };
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
export async function seedDemoLogtech(pool, { dryRun = false } = {}) {
  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id FROM diagnostics WHERE name = $1', [DIAGNOSTIC.name]);
    if (existing.rows.length > 0) {
      return await upgradeExisting(client, existing.rows[0].id, { dryRun });
    }

    console.log(`[SEED] ${dryRun ? 'DRY RUN — nothing will be written' : 'LIVE RUN'}`);

    const totalHeadcount = DEPARTMENTS.reduce((s, d) => s + d.headcount, 0);
    console.log(`[SEED] Plan: 1 diagnostic, ${DIMENSIONS.length} dimensions, ${DIMENSIONS.reduce((s, d) => s + d.questions.length, 0)} questions, ${DEPARTMENTS.length} departments, ${totalHeadcount} users/responses`);
    DEPARTMENTS.forEach((d) => console.log(`        - ${d.name}: ${d.headcount}`));

    if (dryRun) return { status: 'dry-run' };

    await client.query('BEGIN');

    // 1. Diagnostic
    const diagRes = await client.query(
      'INSERT INTO diagnostics (name, description, status, is_nr1) VALUES ($1, $2, $3, $4) RETURNING id',
      [DIAGNOSTIC.name, DIAGNOSTIC.description, DIAGNOSTIC.status, DIAGNOSTIC.is_nr1]
    );
    const diagnosticId = diagRes.rows[0].id;
    console.log(`[SEED] Diagnostic created: id ${diagnosticId}`);

    // 2. Dimensions + questions
    const questionsByDim = {};
    for (let di = 0; di < DIMENSIONS.length; di++) {
      const dim = DIMENSIONS[di];
      const dimRes = await client.query(
        'INSERT INTO dimensions (diagnostic_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
        [diagnosticId, dim.name, di]
      );
      const dimensionId = dimRes.rows[0].id;
      questionsByDim[dim.key] = [];
      for (let qi = 0; qi < dim.questions.length; qi++) {
        const q = dim.questions[qi];
        const qRes = await client.query(
          'INSERT INTO questions (dimension_id, text, type, inverted, required, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [dimensionId, q.text, q.type || 'likert5', !!q.inverted, q.required !== false, qi]
        );
        questionsByDim[dim.key].push({ id: qRes.rows[0].id, inverted: !!q.inverted, type: q.type || 'likert5' });
      }
    }
    const openQ1 = questionsByDim.open[0].id;
    const openQ2 = questionsByDim.open[1].id;
    const enpsQuestionId = questionsByDim.enps[0].id;
    const enpsValues = [];

    // 3. Departments
    for (const dept of DEPARTMENTS) {
      const r = await client.query(
        'INSERT INTO departments (diagnostic_id, name) VALUES ($1, $2) RETURNING id',
        [diagnosticId, dept.name]
      );
      dept.id = r.rows[0].id;
    }

    // 4. Users + enrollments + responses
    const usedEmails = new Set((await client.query('SELECT email FROM users')).rows.map((r) => r.email));
    const hashedPassword = bcrypt.hashSync(DEMO_PASSWORD, 10);
    let usersCreated = 0;
    let responsesCreated = 0;
    let openCreated = 0;

    for (const dept of DEPARTMENTS) {
      // Copy pools so each answer is used at most once per department
      const poolQ1 = [...(OPEN_ANSWERS[dept.name]?.q1 || [])];
      const poolQ2 = [...(OPEN_ANSWERS[dept.name]?.q2 || [])];

      for (let i = 0; i < dept.headcount; i++) {
        let email, fullName, attempts = 0;
        do {
          const first = pick(FIRST_NAMES);
          const last = pick(LAST_NAMES);
          fullName = `${first} ${last}`;
          email = `${first}.${last}${attempts > 0 ? attempts : ''}@${EMAIL_DOMAIN}`
            .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          attempts++;
        } while (usedEmails.has(email) && attempts < 50);
        usedEmails.add(email);

        const u = await client.query(
          'INSERT INTO users (email, password, name, role, department_id, diagnostic_id, email_verified) VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id',
          [email, hashedPassword, fullName, 'user', dept.id, diagnosticId]
        );
        const userId = u.rows[0].id;
        usersCreated++;

        await client.query(
          'INSERT INTO user_diagnostics (user_id, diagnostic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, diagnosticId]
        );

        const { answers, openAnswers } = buildResponse(dept, questionsByDim);
        enpsValues.push(answers[enpsQuestionId]);

        // Open answers: only a fraction of people write, and pools are drawn without replacement
        if (rand() < dept.openRate) {
          if (poolQ1.length > 0 && rand() < 0.9) {
            openAnswers[openQ1] = poolQ1.splice(Math.floor(rand() * poolQ1.length), 1)[0];
          }
          if (poolQ2.length > 0 && rand() < 0.75) {
            openAnswers[openQ2] = poolQ2.splice(Math.floor(rand() * poolQ2.length), 1)[0];
          }
        }
        if (Object.keys(openAnswers).length > 0) openCreated++;

        await client.query(
          'INSERT INTO responses (user_id, department_id, diagnostic_id, answers, open_answers, submitted_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [userId, dept.id, diagnosticId, JSON.stringify(answers), Object.keys(openAnswers).length ? JSON.stringify(openAnswers) : null, randomSubmissionDate()]
        );
        responsesCreated++;
      }
    }

    // 5. Grant access to every existing RH user (insert-only)
    const rhUsers = await client.query("SELECT id, email FROM users WHERE role = 'rh'");
    for (const rh of rhUsers.rows) {
      await client.query(
        'INSERT INTO user_diagnostics_access (user_id, diagnostic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [rh.id, diagnosticId]
      );
    }

    await client.query('COMMIT');

    console.log('[SEED] Done.');
    console.log(`       diagnostic id: ${diagnosticId}`);
    console.log(`       users: ${usersCreated} (password "${DEMO_PASSWORD}", domain @${EMAIL_DOMAIN})`);
    console.log(`       responses: ${responsesCreated} (${openCreated} with open answers)`);
    const enps = enpsSummary(enpsValues);
    console.log(`       eNPS: ${enps.score} (promoters ${enps.promoters}% / neutrals ${enps.neutrals}% / detractors ${enps.detractors}%)`);
    console.log(`       RH users granted access: ${rhUsers.rows.length}`);
    return { status: 'created', diagnosticId, users: usersCreated, responses: responsesCreated };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[SEED] Error — transaction rolled back, nothing was written:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------
// Upgrades for a dataset that was already seeded (idempotent, scoped to that diagnostic).
// Never deletes anything. Each upgrade is skipped when it has already been applied.
// ------------------------------------------------------------------
async function upgradeExisting(client, diagnosticId, { dryRun = false } = {}) {
  console.log(`[SEED] "${DIAGNOSTIC.name}" already exists (id ${diagnosticId}) — checking for pending upgrades.`);
  const pending = [];

  // Upgrade 1: renamed departments
  const depts = await client.query('SELECT id, name FROM departments WHERE diagnostic_id = $1', [diagnosticId]);
  const renames = depts.rows
    .filter((d) => RENAMED_DEPARTMENTS[d.name])
    .map((d) => ({ id: d.id, from: d.name, to: RENAMED_DEPARTMENTS[d.name] }));
  renames.forEach((r) => pending.push(`rename department "${r.from}" → "${r.to}"`));

  // Upgrade 2: eNPS question + an eNPS answer in every existing response
  const npsQ = await client.query(
    "SELECT q.id FROM questions q JOIN dimensions d ON d.id = q.dimension_id WHERE d.diagnostic_id = $1 AND q.type = 'nps'",
    [diagnosticId]
  );
  const needsEnps = npsQ.rows.length === 0;
  if (needsEnps) pending.push('add eNPS dimension/question and an eNPS answer to every existing response');

  if (pending.length === 0) {
    console.log('[SEED] Up to date — nothing changed.');
    return { status: 'exists', diagnosticId };
  }
  console.log(`[SEED] ${dryRun ? 'DRY RUN — nothing will be written' : 'LIVE RUN'}. Pending upgrades:`);
  pending.forEach((p) => console.log(`        - ${p}`));
  if (dryRun) return { status: 'dry-run', diagnosticId };

  await client.query('BEGIN');

  for (const r of renames) {
    await client.query('UPDATE departments SET name = $1 WHERE id = $2 AND diagnostic_id = $3', [r.to, r.id, diagnosticId]);
  }

  let enps = null;
  if (needsEnps) {
    const enpsDim = DIMENSIONS.find((d) => d.key === 'enps');
    const openDim = DIMENSIONS.find((d) => d.key === 'open');

    // Place eNPS right before the open-questions dimension (same order as a fresh seed)
    const openRow = await client.query(
      'SELECT sort_order FROM dimensions WHERE diagnostic_id = $1 AND name = $2',
      [diagnosticId, openDim.name]
    );
    let sortOrder;
    if (openRow.rows.length > 0) {
      sortOrder = openRow.rows[0].sort_order;
      await client.query(
        'UPDATE dimensions SET sort_order = sort_order + 1 WHERE diagnostic_id = $1 AND sort_order >= $2',
        [diagnosticId, sortOrder]
      );
    } else {
      const mx = await client.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM dimensions WHERE diagnostic_id = $1', [diagnosticId]);
      sortOrder = mx.rows[0].next;
    }

    const dimRes = await client.query(
      'INSERT INTO dimensions (diagnostic_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
      [diagnosticId, enpsDim.name, sortOrder]
    );
    const q = enpsDim.questions[0];
    const qRes = await client.query(
      'INSERT INTO questions (dimension_id, text, type, inverted, required, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [dimRes.rows[0].id, q.text, q.type, false, true, 0]
    );
    const enpsQuestionId = qRes.rows[0].id;

    const likertQuestions = (await client.query(
      "SELECT q.id, q.inverted FROM questions q JOIN dimensions d ON d.id = q.dimension_id WHERE d.diagnostic_id = $1 AND q.type = 'likert5'",
      [diagnosticId]
    )).rows;
    const responses = await client.query('SELECT id, answers FROM responses WHERE diagnostic_id = $1 ORDER BY id', [diagnosticId]);

    const values = [];
    for (const row of responses.rows) {
      const answers = typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers;
      if (answers[enpsQuestionId] !== undefined) continue;
      const v = enpsFor(answers, likertQuestions);
      values.push(v);
      // jsonb concatenation only adds the new key; every existing answer is kept untouched
      await client.query(
        'UPDATE responses SET answers = answers || $1::jsonb WHERE id = $2 AND diagnostic_id = $3',
        [JSON.stringify({ [enpsQuestionId]: v }), row.id, diagnosticId]
      );
    }
    enps = { questionId: enpsQuestionId, responses: values.length, ...enpsSummary(values) };
  }

  await client.query('COMMIT');

  console.log('[SEED] Upgrade done.');
  renames.forEach((r) => console.log(`       department renamed: "${r.from}" → "${r.to}"`));
  if (enps) {
    console.log(`       eNPS question id: ${enps.questionId}, answers added to ${enps.responses} responses`);
    console.log(`       eNPS: ${enps.score} (promoters ${enps.promoters}% / neutrals ${enps.neutrals}% / detractors ${enps.detractors}%)`);
  }
  return { status: 'upgraded', diagnosticId, renames: renames.length, enps };
}

// Standalone CLI mode
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  dotenv.config();
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  seedDemoLogtech(pool, { dryRun: process.argv.includes('--dry-run') })
    .catch(() => { process.exitCode = 1; })
    .finally(() => pool.end());
}
