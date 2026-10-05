// Quantifies the free-text answers of a diagnostic.
// The AI only defines the themes and classifies each respondent; every count and
// percentage in the report is computed here, from those classifications. The
// report carries no AI-written conclusions or recommendations.
import Anthropic from '@anthropic-ai/sdk';
import { dbGet, dbAll, dbRun } from './database.js';

const MODEL = 'claude-opus-5-5';
const MAX_INDICATORS = 10;
const MAX_CATEGORIES = 6;
export const MIN_GROUP_SIZE = 5;   // anonymity: smaller groups are merged into "Outros"
const MIN_TEXT_RESPONDENTS = 5;
const BATCH_SIZE = 30;
const CONCURRENCY = 3;

// Fixed open questions shown on the last survey screen (see src/App.jsx)
const FIXED_OPEN_QUESTIONS = [
  { id: 'open1', text: 'Na sua opinião, o que a empresa poderia fazer para melhorar o ambiente de trabalho?' },
  { id: 'open2', text: 'Há algo mais que gostaria de compartilhar sobre sua experiência na empresa?' },
];

const parseJson = (value) => {
  if (!value) return {};
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (e) { return {}; }
};

const cleanText = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// ==========================================
// DATA COLLECTION
// ==========================================

export async function collectTexts(diagnosticId) {
  const diagnostic = await dbGet('SELECT id, name FROM diagnostics WHERE id = $1', [diagnosticId]);
  if (!diagnostic) return null;

  const questions = await dbAll(`
    SELECT q.id, q.text, q.type, q.options, q.is_demographic
    FROM questions q
    JOIN dimensions d ON q.dimension_id = d.id
    WHERE d.diagnostic_id = $1
    ORDER BY d.sort_order, q.sort_order
  `, [diagnosticId]);

  const responses = await dbAll(`
    SELECT r.id, r.answers, r.open_answers, dep.name as department_name
    FROM responses r
    LEFT JOIN departments dep ON r.department_id = dep.id
    WHERE r.diagnostic_id = $1
    ORDER BY r.id
  `, [diagnosticId]);

  // Open questions, each with the question asked right before it as context ("Por quê?")
  const openQuestions = [];
  questions.forEach((q, idx) => {
    if (q.type !== 'open') return;
    const previous = idx > 0 && questions[idx - 1].type !== 'open' ? questions[idx - 1].text : null;
    openQuestions.push({ id: String(q.id), text: q.text, context: previous });
  });
  FIXED_OPEN_QUESTIONS.forEach(q => openQuestions.push({ ...q, context: null }));

  // Group by job role when the survey asks for it, otherwise by department
  const roleQuestion = questions.find(q =>
    (q.is_demographic || q.type === 'single_choice') && /fun[cç][aã]o|cargo/i.test(q.text)
  );
  const groupLabel = roleQuestion ? 'Cargo' : 'Departamento';

  const respondents = responses.map((r, idx) => {
    const answers = parseJson(r.answers);
    const openAnswers = parseJson(r.open_answers);
    const texts = {};
    for (const q of openQuestions) {
      // The survey saves open questions in answers; seeded data saves them in open_answers
      const text = cleanText(answers[q.id]) || cleanText(openAnswers[q.id]);
      if (text.length >= 2) texts[q.id] = text;
    }
    const group = roleQuestion ? cleanText(answers[roleQuestion.id]) : cleanText(r.department_name);
    return { rid: idx + 1, group: group || 'Não informado', texts };
  });

  const usedQuestions = openQuestions.filter(q => respondents.some(r => r.texts[q.id]));

  return { diagnostic, respondents, openQuestions: usedQuestions, groupLabel };
}

// ==========================================
// AI CALLS
// ==========================================

const str = { type: 'string' };
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items) => ({ type: 'array', items });

const TAXONOMY_SCHEMA = obj({
  indicators: arr(obj({ id: str, name: str, description: str, quotes: arr(str) })),
  questions: arr(obj({
    question_id: str,
    short_title: str,
    categories: arr(obj({ id: str, label: str })),
  })),
});

const CLASSIFICATION_SCHEMA = obj({
  respondents: arr(obj({
    rid: { type: 'integer' },
    indicators: arr(obj({ id: str, sentiment: { type: 'string', enum: ['critica', 'neutra', 'elogio'] } })),
    answers: arr(obj({ question_id: str, category_ids: arr(str) })),
  })),
});

const SYSTEM_PROMPT = `Você é um analista de pesquisas de clima organizacional. Organiza respostas abertas e anônimas de uma pesquisa interna com colaboradores de uma empresa brasileira em temas e categorias, para que possam ser contadas e apresentadas à diretoria.
Escreva sempre em português do Brasil, com rótulos curtos, neutros e descritivos. Baseie-se apenas no que está nos textos; não interprete além do que foi escrito nem sugira ações. Nunca inclua nomes de pessoas nem detalhes que identifiquem um respondente.`;

async function callClaude(client, schema, prompt, maxTokens = 32000) {
  const message = await client.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  }).finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('A IA recusou a análise deste conteúdo.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('A resposta da IA foi interrompida por tamanho. Tente novamente.');
  }
  const textBlock = message.content.find(block => block.type === 'text');
  if (!textBlock) throw new Error('A IA não retornou conteúdo.');
  return JSON.parse(textBlock.text);
}

const renderQuestions = (openQuestions) => openQuestions.map(q =>
  `- [${q.id}] ${q.text}${q.context ? ` (pergunta de acompanhamento de: "${q.context}")` : ''}`
).join('\n');

const renderRespondents = (respondents, openQuestions) => respondents.map(r => {
  const lines = openQuestions.filter(q => r.texts[q.id]).map(q => `  [${q.id}] ${r.texts[q.id]}`);
  return `Respondente ${r.rid}:\n${lines.join('\n')}`;
}).join('\n\n');

async function buildTaxonomy(client, respondents, openQuestions) {
  const prompt = `Abaixo estão as respostas abertas de ${respondents.length} colaboradores.

PERGUNTAS:
${renderQuestions(openQuestions)}

RESPOSTAS:
${renderRespondents(respondents, openQuestions)}

Faça duas coisas:

1. INDICADORES TRANSVERSAIS — defina de 6 a ${MAX_INDICATORS} indicadores temáticos que resumem o que aparece nos textos como um todo (exemplos de formato: "Espaço físico e estrutura", "Escala e carga de trabalho", "Liderança e comunicação"). Devem ser mutuamente distintos, relevantes para a diretoria e ancorados no que foi escrito; não crie indicador para tema citado por uma única pessoa. Para cada um: id ("I1", "I2"...), nome curto (até 4 palavras), descrição de uma frase, e até 2 citações literais curtas (até 140 caracteres, copiadas exatamente de uma resposta, sem nomes nem detalhes que identifiquem alguém).

2. CATEGORIAS POR PERGUNTA — para cada pergunta, um short_title (até 6 palavras, afirmativo, ex.: "Benefício mais desejado") e de 3 a ${MAX_CATEGORIES} categorias de resposta (id "C1", "C2"..., rótulo de até 4 palavras) que cubram a grande maioria das respostas daquela pergunta. Use o question_id exatamente como aparece entre colchetes.`;

  return callClaude(client, TAXONOMY_SCHEMA, prompt);
}

async function classifyBatch(client, batch, openQuestions, taxonomy) {
  const indicators = taxonomy.indicators.map(i => `- ${i.id}: ${i.name} — ${i.description}`).join('\n');
  const categories = taxonomy.questions.map(q =>
    `- [${q.question_id}] ${q.categories.map(c => `${c.id}=${c.label}`).join('; ')}`
  ).join('\n');

  const prompt = `Classifique as respostas abertas de cada respondente.

INDICADORES:
${indicators}

PERGUNTAS:
${renderQuestions(openQuestions)}

CATEGORIAS POR PERGUNTA:
${categories}

RESPOSTAS:
${renderRespondents(batch, openQuestions)}

Para cada respondente (use o mesmo número em "rid"):
- "indicators": os indicadores que a pessoa aborda em qualquer uma de suas respostas, cada um no máximo uma vez, com o tom predominante: "critica" (reclamação, falta, pedido de mudança), "elogio" (satisfação, algo que funciona bem) ou "neutra". Marque apenas o que está de fato escrito; respostas vagas ("nada", "tudo bem", "não sei") não recebem indicador.
- "answers": para cada pergunta respondida, as categorias daquela pergunta em que a resposta se encaixa (pode ser mais de uma, ou nenhuma se não se encaixar).

Inclua todos os ${batch.length} respondentes.`;

  return callClaude(client, CLASSIFICATION_SCHEMA, prompt);
}

async function classifyAll(client, respondents, openQuestions, taxonomy) {
  const batches = [];
  for (let i = 0; i < respondents.length; i += BATCH_SIZE) batches.push(respondents.slice(i, i + BATCH_SIZE));

  const results = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      results[index] = await classifyBatch(client, batches[index], openQuestions, taxonomy);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return results.flatMap(r => r.respondents);
}

// ==========================================
// AGGREGATION
// ==========================================

const pct = (count, base) => (base > 0 ? Math.round((count / base) * 100) : 0);
const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function buildGroups(respondents) {
  const sizes = new Map();
  respondents.forEach(r => sizes.set(r.group, (sizes.get(r.group) || 0) + 1));
  const kept = [...sizes.entries()].filter(([, n]) => n >= MIN_GROUP_SIZE).sort((a, b) => b[1] - a[1]);
  const keptNames = new Set(kept.map(([name]) => name));
  const othersCount = respondents.filter(r => !keptNames.has(r.group)).length;

  const groups = kept.map(([name, n]) => ({ name, n }));
  if (othersCount >= MIN_GROUP_SIZE) groups.push({ name: 'Outros', n: othersCount });

  const groupOf = (r) => {
    if (keptNames.has(r.group)) return r.group;
    return othersCount >= MIN_GROUP_SIZE ? 'Outros' : null;
  };
  return { groups, groupOf, hidden: othersCount >= MIN_GROUP_SIZE ? 0 : othersCount };
}

function aggregate({ diagnostic, respondents, openQuestions, groupLabel }, taxonomy, classifications) {
  const total = respondents.length;
  const withText = respondents.filter(r => Object.keys(r.texts).length > 0);
  const byRid = new Map(classifications.map(c => [c.rid, c]));
  const { groups, groupOf, hidden } = buildGroups(respondents);
  const allTexts = withText.flatMap(r => Object.values(r.texts)).map(normalize);

  const indicators = taxonomy.indicators.slice(0, MAX_INDICATORS).map(ind => {
    const counts = { critica: 0, neutra: 0, elogio: 0 };
    const groupCounts = groups.map(() => ({ mentions: 0, critical: 0 }));

    for (const r of withText) {
      const hit = byRid.get(r.rid)?.indicators.find(i => i.id === ind.id);
      if (!hit) continue;
      counts[hit.sentiment]++;
      const gi = groups.findIndex(g => g.name === groupOf(r));
      if (gi >= 0) {
        groupCounts[gi].mentions++;
        if (hit.sentiment === 'critica') groupCounts[gi].critical++;
      }
    }

    const mentions = counts.critica + counts.neutra + counts.elogio;
    // Keep only quotes that really are in the answers
    const quotes = (ind.quotes || [])
      .map(cleanText)
      .filter(q => q.length >= 8 && q.length <= 180 && allTexts.some(t => t.includes(normalize(q))))
      .slice(0, 2);

    return {
      id: ind.id, name: ind.name, description: ind.description,
      mentions, pct: pct(mentions, total),
      critical: counts.critica, neutral: counts.neutra, praise: counts.elogio,
      pctCritical: pct(counts.critica, total),
      quotes,
      byGroup: groups.map((g, gi) => ({
        mentions: groupCounts[gi].mentions,
        critical: groupCounts[gi].critical,
        pctCritical: pct(groupCounts[gi].critical, g.n),
      })),
    };
  }).filter(i => i.mentions > 0).sort((a, b) => b.mentions - a.mentions);

  const questions = openQuestions.map(q => {
    const tax = taxonomy.questions.find(t => t.question_id === q.id);
    const answeredBy = withText.filter(r => r.texts[q.id]);
    const categories = (tax?.categories || []).slice(0, MAX_CATEGORIES).map(cat => {
      const count = answeredBy.filter(r =>
        byRid.get(r.rid)?.answers.find(a => a.question_id === q.id)?.category_ids.includes(cat.id)
      ).length;
      return { label: cat.label, count, pct: pct(count, answeredBy.length) };
    }).filter(c => c.count > 0).sort((a, b) => b.count - a.count);

    return { id: q.id, text: q.text, title: tax?.short_title || q.text, answered: answeredBy.length, categories };
  }).filter(q => q.answered > 0 && q.categories.length > 0);

  return {
    meta: {
      diagnosticId: diagnostic.id,
      diagnosticName: diagnostic.name,
      generatedAt: new Date().toISOString(),
      totalResponses: total,
      withText: withText.length,
      commentCount: withText.reduce((sum, r) => sum + Object.keys(r.texts).length, 0),
      groupLabel,
      hiddenGroupRespondents: hidden,
      minGroupSize: MIN_GROUP_SIZE,
      model: MODEL,
    },
    indicators,
    groups,
    questions,
  };
}

// ==========================================
// PUBLIC API
// ==========================================

// Runs the whole analysis and returns the report data. Does not touch the database
// beyond reading the responses.
export async function runAnalysis(diagnosticId) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Chave da API de IA não configurada. Configure ANTHROPIC_API_KEY no Railway.');
  }
  const data = await collectTexts(diagnosticId);
  if (!data) throw new Error('Diagnóstico não encontrado');

  const withText = data.respondents.filter(r => Object.keys(r.texts).length > 0);
  if (withText.length < MIN_TEXT_RESPONDENTS) {
    throw new Error(`São necessárias pelo menos ${MIN_TEXT_RESPONDENTS} respostas com texto para gerar o relatório (há ${withText.length}).`);
  }

  const client = new Anthropic();
  const taxonomy = await buildTaxonomy(client, withText, data.openQuestions);
  const classifications = await classifyAll(client, withText, data.openQuestions, taxonomy);
  const stats = aggregate(data, taxonomy, classifications);
  if (stats.indicators.length === 0) throw new Error('A análise não encontrou temas nos textos.');
  return stats;
}

// In-memory job tracking (single server instance)
const jobs = new Map();

async function countResponses(diagnosticId) {
  const row = await dbGet('SELECT COUNT(*) as count FROM responses WHERE diagnostic_id = $1', [diagnosticId]);
  return parseInt(row.count);
}

export async function getLatestAnalysis(diagnosticId) {
  const row = await dbGet(
    'SELECT result, responses_count, created_at FROM text_analyses WHERE diagnostic_id = $1 ORDER BY id DESC LIMIT 1',
    [diagnosticId]
  );
  return row ? { result: parseJson(row.result), responsesCount: row.responses_count, createdAt: row.created_at } : null;
}

// status: 'running' | 'error' | 'ready' | 'stale' (new responses since the analysis) | 'none'
export async function getAnalysisStatus(diagnosticId) {
  const job = jobs.get(String(diagnosticId));
  if (job?.status === 'running') return { status: 'running' };

  const latest = await getLatestAnalysis(diagnosticId);
  if (job?.status === 'error') return { status: 'error', error: job.error, hasReport: !!latest };
  if (!latest) return { status: 'none' };

  const current = await countResponses(diagnosticId);
  return {
    status: current === latest.responsesCount ? 'ready' : 'stale',
    analyzedAt: latest.createdAt,
    hasReport: true,
  };
}

// Starts the analysis in the background unless a current one already exists
export async function startAnalysis(diagnosticId, { force = false } = {}) {
  const key = String(diagnosticId);
  const status = await getAnalysisStatus(diagnosticId);
  if (status.status === 'running') return status;
  if (status.status === 'ready' && !force) return status;

  jobs.set(key, { status: 'running' });
  (async () => {
    try {
      const responsesCount = await countResponses(diagnosticId);
      const result = await runAnalysis(diagnosticId);
      await dbRun(
        'INSERT INTO text_analyses (diagnostic_id, responses_count, model, result) VALUES ($1, $2, $3, $4)',
        [diagnosticId, responsesCount, MODEL, JSON.stringify(result)]
      );
      jobs.delete(key);
    } catch (error) {
      console.error('[TEXT-ANALYSIS] Erro:', error);
      jobs.set(key, { status: 'error', error: error.message || 'Erro ao analisar os textos' });
    }
  })();
  return { status: 'running' };
}
