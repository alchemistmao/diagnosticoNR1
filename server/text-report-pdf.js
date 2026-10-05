// Renders the executive PDF (5 pages, A4) from the data produced by text-analysis.js.
// All charts are drawn as vectors with pdfkit; no browser involved.
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(here, '..', 'public', 'logo-report.png');

const W = 595.28;
const H = 841.89;
const M = 44;
const CW = W - M * 2;

const C = {
  ink: '#1F2A24',
  muted: '#5F6B66',
  faint: '#E6E9EA',
  panel: '#F6F7F5',
  cover: '#17332F',
  accent: '#00E8C8',
  teal: '#1F7A6E',
  critical: '#C8553D',
  neutral: '#C2C8CC',
  praise: '#2F6DB5',
  warning: '#D9A21B',
  white: '#FFFFFF',
};
const HEAT_LOW = [251, 240, 236];
const HEAT_HIGH = [176, 62, 40];

const FONT = { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' };

// The built-in PDF fonts only cover WinAnsi; drop anything else (emoji etc.)
const sanitize = (value) => String(value ?? '')
  .replace(/[‘’]/g, "'")
  .replace(/[^ -~ -ÿ–—“”•…]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const heatColor = (value, max) => {
  const t = max > 0 ? Math.min(1, value / max) : 0;
  return '#' + HEAT_LOW
    .map((low, i) => Math.round(low + (HEAT_HIGH[i] - low) * t).toString(16).padStart(2, '0'))
    .join('');
};

export function buildTextReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: {
      Title: `Relatório Executivo - ${sanitize(report.meta.diagnosticName)}`,
      Author: 'Cuidar+',
    } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { meta, indicators, groups, questions, narrative } = report;
    const TOTAL_PAGES = 5;
    const groupWord = meta.groupLabel.toLowerCase();
    const dateStr = new Date(meta.generatedAt).toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo',
    });

    // ---------- primitives ----------
    const setFont = (opts) => doc.font(opts.font || FONT.regular).fontSize(opts.size || 9);
    const heightOf = (value, opts) => {
      setFont(opts);
      return doc.heightOfString(sanitize(value), { width: opts.width, lineGap: opts.lineGap || 0 });
    };
    // Draws text clamped to opts.height (never flows to another page); returns the height used
    const text = (value, x, y, opts = {}) => {
      const content = sanitize(value);
      setFont(opts);
      const full = doc.heightOfString(content, { width: opts.width, lineGap: opts.lineGap || 0 });
      const height = opts.height ? Math.min(full, opts.height) : full;
      doc.fillColor(opts.color || C.ink).text(content, x, y, {
        width: opts.width,
        height: opts.height ? opts.height + 0.5 : undefined,
        ellipsis: !!opts.height,
        align: opts.align || 'left',
        lineGap: opts.lineGap || 0,
        characterSpacing: opts.spacing || 0,
      });
      return height;
    };
    const box = (x, y, w, h, color, radius = 0) => {
      if (w <= 0 || h <= 0) return;
      (radius ? doc.roundedRect(x, y, w, h, Math.min(radius, w / 2, h / 2)) : doc.rect(x, y, w, h)).fill(color);
    };
    const line = (x1, y1, x2, y2, color = C.faint, width = 0.75) => {
      doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(color).stroke();
    };

    const footer = (page) => {
      line(M, H - 40, W - M, H - 40);
      text('Confidencial · Cuidar+ · Resultados agregados e anônimos', M, H - 32, { size: 7.5, color: C.muted, width: CW - 60 });
      text(`${page} / ${TOTAL_PAGES}`, W - M - 60, H - 32, { size: 7.5, color: C.muted, width: 60, align: 'right' });
    };

    // Starts an inner page and returns the y where content begins
    const startPage = (page, title, subtitle) => {
      doc.addPage();
      text('RELATÓRIO EXECUTIVO · VOZ DOS COLABORADORES', M, 34, { size: 7, font: FONT.bold, color: C.teal, width: 300, spacing: 0.6 });
      text(meta.diagnosticName, M + 300, 34, { size: 7.5, color: C.muted, width: CW - 300, align: 'right', height: 10 });
      line(M, 48, W - M, 48);
      text(title, M, 62, { size: 19, font: FONT.bold, width: CW, height: 24 });
      const used = text(subtitle, M, 88, { size: 9.5, color: C.muted, width: CW, height: 26, lineGap: 1.5 });
      footer(page);
      return 88 + used + 20;
    };

    const sectionTitle = (label, y) => {
      text(label.toUpperCase(), M, y, { size: 8, font: FONT.bold, color: C.teal, width: CW, spacing: 0.8 });
      return y + 16;
    };

    // ==========================================
    // PAGE 1 — cover + executive summary
    // ==========================================
    doc.addPage();
    box(0, 0, W, 196, C.cover);
    box(0, 196, W, 4, C.accent);
    let textX = M;
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, M, 44, { width: 84 });
      textX = M + 104;
    }
    text('RELATÓRIO EXECUTIVO', textX, 50, { size: 8.5, font: FONT.bold, color: C.accent, width: 300, spacing: 1.2 });
    text('Voz dos Colaboradores', textX, 66, { size: 27, font: FONT.bold, color: C.white, width: CW - 104 });
    text('O que as respostas abertas da pesquisa revelam', textX, 100, { size: 11, color: '#CFE3DF', width: CW - 104 });
    text(meta.diagnosticName, textX, 138, { size: 10, font: FONT.bold, color: C.white, width: CW - 104, height: 12 });
    text(dateStr, textX, 153, { size: 9, color: '#CFE3DF', width: CW - 104 });

    let y = 226;
    y += text(narrative.headline, M, y, { size: 15.5, font: FONT.bold, width: CW, height: 62, lineGap: 2.5 }) + 20;

    // KPI tiles
    const topIndicator = indicators[0];
    const tiles = [
      { value: String(meta.totalResponses), label: 'respondentes na pesquisa' },
      { value: `${Math.round((meta.withText / meta.totalResponses) * 100)}%`, label: `deixaram comentários (${meta.withText} pessoas)` },
      { value: String(meta.commentCount), label: 'comentários analisados' },
      { value: `${topIndicator.pct}%`, label: `citam "${topIndicator.name}", o tema mais citado` },
    ];
    const tileW = (CW - 30) / 4;
    tiles.forEach((tile, i) => {
      const x = M + i * (tileW + 10);
      box(x, y, tileW, 84, C.panel, 6);
      text(tile.value, x + 12, y + 11, { size: 23, font: FONT.bold, width: tileW - 24 });
      text(tile.label, x + 12, y + 41, { size: 7.8, color: C.muted, width: tileW - 24, height: 38, lineGap: 1 });
    });
    y += 84 + 24;

    y = sectionTitle('Principais achados', y);
    for (const item of narrative.summary.slice(0, 4)) {
      box(M, y + 3.5, 5, 5, C.accent, 1);
      y += text(item, M + 14, y, { size: 10, width: CW - 14, height: 40, lineGap: 2 }) + 9;
    }
    y += 12;

    y = sectionTitle('Alertas', y);
    for (const alert of narrative.alerts.slice(0, 4)) {
      const bodyH = heightOf(alert.text, { size: 9, width: CW - 110, lineGap: 1.5 });
      const cardH = Math.max(40, 12 + 13 + Math.min(bodyH, 36) + 10);
      if (y + cardH > H - 52) break;
      const critical = alert.severity === 'critico';
      box(M, y, CW, cardH, C.panel, 5);
      box(M, y, 4, cardH, critical ? C.critical : C.warning);
      // Severity is carried by the label and the marker shape, not by color alone
      const tagX = M + 16;
      if (critical) doc.polygon([tagX + 5, y + 13], [tagX + 10, y + 22], [tagX, y + 22]).fill(C.critical);
      else doc.circle(tagX + 5, y + 18, 4.5).fill(C.warning);
      text(critical ? 'CRÍTICO' : 'ATENÇÃO', tagX + 15, y + 14.5, { size: 7, font: FONT.bold, width: 60, spacing: 0.5 });
      text(alert.title, M + 96, y + 11, { size: 10.5, font: FONT.bold, width: CW - 110, height: 13 });
      text(alert.text, M + 96, y + 25, { size: 9, color: C.muted, width: CW - 110, height: 36, lineGap: 1.5 });
      y += cardH + 8;
    }
    footer(1);

    // ==========================================
    // PAGE 2 — indicator ranking
    // ==========================================
    y = startPage(2, 'O que os colaboradores estão dizendo',
      `Percentual dos ${meta.totalResponses} respondentes que mencionam cada tema nas respostas abertas, e o tom dessas menções.`);

    const labelW = 172;
    const valueW = 78;
    const barX = M + labelW + 12;
    const barW = CW - labelW - 12 - valueW;
    const maxPct = Math.max(...indicators.map(i => i.pct), 10);
    const scale = Math.ceil(maxPct / 10) * 10;

    // Legend
    const legend = [['Crítica', C.critical], ['Neutra', C.neutral], ['Elogio', C.praise]];
    let lx = barX;
    legend.forEach(([label, color]) => {
      box(lx, y + 1, 9, 9, color, 2);
      text(label, lx + 13, y + 1.5, { size: 8, color: C.muted, width: 50 });
      lx += 62;
    });
    y += 22;

    // Axis
    const ticks = scale <= 40 ? 10 : 20;
    for (let t = 0; t <= scale; t += ticks) {
      const tx = barX + (t / scale) * barW;
      text(`${t}%`, tx - 15, y, { size: 7, color: C.muted, width: 30, align: 'center' });
    }
    y += 12;
    const rowH = Math.min(42, (H - 240 - y) / indicators.length);
    const axisTop = y;
    for (let t = 0; t <= scale; t += ticks) {
      const tx = barX + (t / scale) * barW;
      line(tx, axisTop, tx, axisTop + rowH * indicators.length - 6, C.faint, 0.5);
    }

    indicators.forEach((ind, idx) => {
      const ry = y + idx * rowH;
      text(ind.name, M, ry + 1, { size: 9.5, font: FONT.bold, width: labelW, height: 12 });
      text(ind.description, M, ry + 14, { size: 7.3, color: C.muted, width: labelW, height: Math.min(18, rowH - 20), lineGap: 0.5 });

      const fullW = (ind.pct / scale) * barW;
      let sx = barX;
      const segments = [[ind.critical, C.critical], [ind.neutral, C.neutral], [ind.praise, C.praise]].filter(([n]) => n > 0);
      segments.forEach(([count, color], si) => {
        const gap = si < segments.length - 1 ? 2 : 0;
        const sw = Math.max(1.5, (count / ind.mentions) * fullW - gap);
        box(sx, ry + 3, sw, 12, color, 2);
        sx += sw + gap;
      });
      text(`${ind.critical} críticas · ${ind.neutral} neutras · ${ind.praise} elogios`, barX, ry + 19,
        { size: 7, color: C.muted, width: barW });

      text(`${ind.pct}%`, barX + barW + 8, ry + 1, { size: 12, font: FONT.bold, width: valueW - 8, align: 'right' });
      text(`${ind.mentions} de ${meta.totalResponses}`, barX + barW + 8, ry + 16, { size: 7.3, color: C.muted, width: valueW - 8, align: 'right' });
    });
    y += rowH * indicators.length + 14;

    // Quotes
    const quotes = indicators.filter(i => i.quotes.length > 0).slice(0, 4).map(i => ({ quote: i.quotes[0], name: i.name }));
    if (quotes.length > 0 && y < H - 150) {
      y = sectionTitle('Nas palavras dos colaboradores', y);
      const qW = (CW - 14) / 2;
      const qH = Math.min(62, (H - 56 - y - 10) / Math.ceil(quotes.length / 2) - 8);
      quotes.forEach((q, i) => {
        const qx = M + (i % 2) * (qW + 14);
        const qy = y + Math.floor(i / 2) * (qH + 8);
        box(qx, qy, qW, qH, C.panel, 5);
        box(qx, qy, 3, qH, C.accent);
        text(`“${q.quote}”`, qx + 14, qy + 9, { size: 9, font: FONT.italic, width: qW - 26, height: qH - 30, lineGap: 1.5 });
        text(q.name.toUpperCase(), qx + 14, qy + qH - 15, { size: 6.5, font: FONT.bold, color: C.muted, width: qW - 26, spacing: 0.5, height: 8 });
      });
    }

    // ==========================================
    // PAGE 3 — heatmap by group
    // ==========================================
    y = startPage(3, `Onde as críticas se concentram, por ${groupWord}`,
      `Cada célula mostra o percentual dos colaboradores daquele ${groupWord} que fazem uma crítica ligada ao tema. Quanto mais escura, maior a concentração.`);

    const shownGroups = groups.slice(0, 8);
    const columns = [{ name: 'Empresa', n: meta.totalResponses, total: true }, ...shownGroups];
    const hLabelW = 158;
    const cellGap = 2;
    const cellW = (CW - hLabelW) / columns.length;
    const cellH = Math.min(30, 300 / indicators.length);
    const cellValue = (ind, col) => (col.total ? ind.pctCritical : ind.byGroup[groups.indexOf(col)].pctCritical);
    const heatMax = Math.max(30, ...indicators.flatMap(ind => columns.map(col => cellValue(ind, col))));

    columns.forEach((col, ci) => {
      const cx = M + hLabelW + ci * cellW;
      text(col.name, cx, y, { size: 6.8, font: FONT.bold, width: cellW - cellGap, height: 26, align: 'center' });
      text(`n = ${col.n}`, cx + 2, y + 28, { size: 6.8, color: C.muted, width: cellW - 4, align: 'center' });
    });
    y += 42;

    indicators.forEach((ind, ri) => {
      const ry = y + ri * (cellH + cellGap);
      text(ind.name, M, ry + cellH / 2 - 5, { size: 8.8, font: FONT.bold, width: hLabelW - 10, height: 11 });
      columns.forEach((col, ci) => {
        const value = cellValue(ind, col);
        const cx = M + hLabelW + ci * cellW;
        box(cx, ry, cellW - cellGap, cellH, heatColor(value, heatMax), 3);
        const dark = value / heatMax > 0.55;
        text(`${value}%`, cx, ry + cellH / 2 - 4.5, {
          size: 9, font: col.total ? FONT.bold : FONT.regular, color: dark ? C.white : C.ink, width: cellW - cellGap, align: 'center',
        });
      });
    });
    y += indicators.length * (cellH + cellGap) + 12;

    // Legend ramp
    const rampW = 150;
    const rampX = M + hLabelW;
    for (let i = 0; i < 30; i++) {
      box(rampX + (i * rampW) / 30, y, rampW / 30 + 0.5, 7, heatColor(i, 29));
    }
    text('0%', rampX - 24, y - 0.5, { size: 7, color: C.muted, width: 20, align: 'right' });
    text(`${heatMax}% com menção crítica`, rampX + rampW + 6, y - 0.5, { size: 7, color: C.muted, width: 160 });
    y += 30;

    y = sectionTitle('Leitura', y);
    const insightH = heightOf(narrative.group_insight, { size: 10, width: CW - 32, lineGap: 2.5 });
    const insightBoxH = Math.min(insightH, 110) + 26;
    box(M, y, CW, insightBoxH, C.panel, 6);
    text(narrative.group_insight, M + 16, y + 13, { size: 10, width: CW - 32, height: 110, lineGap: 2.5 });
    y += insightBoxH + 14;

    const notes = [];
    if (shownGroups.length === 0) notes.push(`Nenhum ${groupWord} tem ${meta.minGroupSize} ou mais respondentes; por anonimato, só o total da empresa é exibido.`);
    else notes.push(`Para preservar o anonimato, grupos com menos de ${meta.minGroupSize} respondentes aparecem somados em "Outros".`);
    if (meta.hiddenGroupRespondents > 0 && shownGroups.length > 0) notes.push(`${meta.hiddenGroupRespondents} respondente(s) de grupos pequenos entram apenas no total da empresa.`);
    if (groups.length > shownGroups.length) notes.push(`São exibidos os ${shownGroups.length} maiores grupos.`);
    text(notes.join(' '), M, y, { size: 7.8, color: C.muted, width: CW, height: 30, lineGap: 1.5 });

    // ==========================================
    // PAGE 4 — answers by question
    // ==========================================
    y = startPage(4, 'Respostas por pergunta',
      'As respostas de cada pergunta aberta, agrupadas por assunto. Percentuais sobre quem respondeu à pergunta; uma resposta pode tratar de mais de um assunto.');

    const shownQuestions = [...questions].sort((a, b) => b.answered - a.answered).slice(0, 8);
    const panelGap = 14;
    const panelW = (CW - panelGap) / 2;
    const panelRows = Math.ceil(shownQuestions.length / 2);
    const panelH = Math.min(165, (H - 56 - y) / panelRows - panelGap);
    const catRows = Math.max(2, Math.min(6, Math.floor((panelH - 50) / 17)));

    shownQuestions.forEach((q, i) => {
      const px = M + (i % 2) * (panelW + panelGap);
      const py = y + Math.floor(i / 2) * (panelH + panelGap);
      box(px, py, panelW, panelH, C.panel, 6);
      text(q.title, px + 12, py + 11, { size: 10, font: FONT.bold, width: panelW - 24, height: 12 });
      text(`${q.answered} respostas · “${q.text}”`, px + 12, py + 25, { size: 7, color: C.muted, width: panelW - 24, height: 9 });

      const catLabelW = 104;
      const catBarX = px + 12 + catLabelW + 6;
      const catBarW = panelW - 24 - catLabelW - 6 - 30;
      const catMax = Math.max(...q.categories.map(c => c.pct), 1);
      q.categories.slice(0, catRows).forEach((cat, ci) => {
        const cy = py + 44 + ci * 17;
        text(cat.label, px + 12, cy + 0.5, { size: 8, width: catLabelW, height: 10 });
        box(catBarX, cy, Math.max(2, (cat.pct / catMax) * catBarW), 9, C.teal, 2);
        text(`${cat.pct}%`, catBarX + catBarW + 4, cy + 0.5, { size: 8, font: FONT.bold, width: 26, align: 'right' });
      });
    });

    // ==========================================
    // PAGE 5 — strengths, recommendations, method
    // ==========================================
    y = startPage(5, 'Pontos fortes e recomendações',
      'O que preservar e por onde começar, em ordem de prioridade.');

    y = sectionTitle('Pontos fortes', y);
    const strengths = narrative.strengths.slice(0, 3);
    if (strengths.length > 0) {
      const sW = (CW - (strengths.length - 1) * 10) / strengths.length;
      const sH = 112;
      strengths.forEach((s, i) => {
        const sx = M + i * (sW + 10);
        box(sx, y, sW, sH, C.panel, 6);
        box(sx, y, sW, 3, C.praise);
        text(s.title, sx + 12, y + 14, { size: 10, font: FONT.bold, width: sW - 24, height: 26, lineGap: 1 });
        const titleH = Math.min(26, heightOf(s.title, { size: 10, font: FONT.bold, width: sW - 24, lineGap: 1 }));
        text(s.text, sx + 12, y + 18 + titleH, { size: 8.5, color: C.muted, width: sW - 24, height: sH - 28 - titleH, lineGap: 1.5 });
      });
      y += sH + 24;
    }

    y = sectionTitle('Recomendações priorizadas', y);
    const recs = narrative.recommendations.slice(0, 5);
    const methodTop = H - 150;
    const recH = Math.min(68, (methodTop - y) / Math.max(recs.length, 1) - 6);
    recs.forEach((rec, i) => {
      const ry = y + i * (recH + 6);
      doc.circle(M + 11, ry + 13, 11).fill(C.cover);
      text(String(i + 1), M, ry + 8.5, { size: 10.5, font: FONT.bold, color: C.white, width: 22, align: 'center' });
      text(rec.title, M + 34, ry + 2, { size: 10.5, font: FONT.bold, width: CW - 34 - 76, height: 13 });
      box(W - M - 64, ry + 1, 64, 15, C.panel, 7.5);
      text(rec.horizon, W - M - 64, ry + 5, { size: 7.3, font: FONT.bold, color: C.teal, width: 64, align: 'center' });
      text(rec.action, M + 34, ry + 18, { size: 9, color: C.muted, width: CW - 34, height: recH - 22, lineGap: 1.5 });
    });

    line(M, methodTop + 6, W - M, methodTop + 6);
    text('COMO ESTE RELATÓRIO FOI FEITO', M, methodTop + 18, { size: 7.5, font: FONT.bold, color: C.teal, width: CW, spacing: 0.8 });
    text(
      `Foram analisados ${meta.commentCount} comentários escritos por ${meta.withText} dos ${meta.totalResponses} respondentes de "${meta.diagnosticName}". ` +
      'Um modelo de inteligência artificial leu os textos, sem nome nem e-mail dos autores, definiu os indicadores a partir do que foi escrito e marcou em cada resposta os temas abordados e o tom (crítica, neutra ou elogio). ' +
      `Todos os percentuais são contagens dessas marcações: os de indicadores têm como base o total de respondentes; os por ${groupWord}, os respondentes de cada grupo; os por pergunta, quem respondeu àquela pergunta. ` +
      'A classificação de texto livre envolve interpretação, portanto os números indicam ordem de grandeza e prioridade, não medidas exatas. As citações são literais e não identificam o autor.',
      M, methodTop + 32, { size: 7.8, color: C.muted, width: CW, height: 64, lineGap: 1.8 });

    doc.end();
  });
}
