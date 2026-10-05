// Reading companion to the executive report: every open-text answer, verbatim,
// organized by question and by job role. No AI involved.
import PDFDocument from 'pdfkit';
import { sanitize } from './text-report-pdf.js';
import { MIN_GROUP_SIZE } from './text-analysis.js';

const M = 48;
const TOP = 64;
const BOTTOM = 58;
const C = { ink: '#1F2A24', muted: '#5F6B66', faint: '#E6E9EA', panel: '#F6F7F5', cover: '#17332F', accent: '#00E8C8', teal: '#1F7A6E', white: '#FFFFFF' };
const FONT = { regular: 'Helvetica', bold: 'Helvetica-Bold' };

// data: the object returned by collectTexts()
export function buildTextListingPdf(data) {
  return new Promise((resolve, reject) => {
    const { diagnostic, respondents, openQuestions, groupLabel } = data;
    const doc = new PDFDocument({
      size: 'A4', bufferPages: true,
      margins: { top: TOP, bottom: BOTTOM, left: M, right: M },
      info: { Title: `Respostas abertas - ${sanitize(diagnostic.name)}`, Author: 'Cuidar+' },
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const H = doc.page.height;
    const CW = W - M * 2;
    const groupWord = groupLabel.toLowerCase();
    const bottomY = H - BOTTOM;

    // Anonymity: groups with fewer than MIN_GROUP_SIZE respondents are shown together
    const sizes = new Map();
    respondents.forEach(r => sizes.set(r.group, (sizes.get(r.group) || 0) + 1));
    const OTHERS = 'Outros';
    const groupOf = (r) => (sizes.get(r.group) >= MIN_GROUP_SIZE ? r.group : OTHERS);
    const groupSizes = new Map();
    respondents.forEach(r => groupSizes.set(groupOf(r), (groupSizes.get(groupOf(r)) || 0) + 1));
    const groupNames = [...groupSizes.keys()].filter(g => g !== OTHERS).sort((a, b) => groupSizes.get(b) - groupSizes.get(a));
    if (groupSizes.has(OTHERS)) groupNames.push(OTHERS);

    const withText = respondents.filter(r => Object.keys(r.texts).length > 0);
    const commentCount = withText.reduce((sum, r) => sum + Object.keys(r.texts).length, 0);
    const dateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

    const ensureSpace = (needed) => {
      if (doc.y + needed > bottomY) doc.addPage();
    };

    // ---------- cover block ----------
    doc.rect(0, 0, W, 150).fill(C.cover);
    doc.rect(0, 150, W, 4).fill(C.accent);
    doc.font(FONT.bold).fontSize(8.5).fillColor(C.accent).text('RESPOSTAS ABERTAS · LEITURA COMPLETA', M, 44, { characterSpacing: 1.2, width: CW });
    doc.font(FONT.bold).fontSize(24).fillColor(C.white).text(`Textos por ${groupWord}`, M, 60, { width: CW });
    doc.font(FONT.bold).fontSize(10).fillColor(C.white).text(sanitize(diagnostic.name), M, 100, { width: CW, height: 12, ellipsis: true });
    doc.font(FONT.regular).fontSize(9).fillColor('#CFE3DF').text(dateStr, M, 115, { width: CW });

    doc.font(FONT.regular).fontSize(9.5).fillColor(C.muted).text(
      sanitize(`${commentCount} respostas escritas por ${withText.length} de ${respondents.length} respondentes, em ${openQuestions.length} perguntas abertas. ` +
        `Os textos estão transcritos como foram escritos, organizados por pergunta e por ${groupWord}, em ordem alfabética. ` +
        `Para preservar o anonimato, ${groupWord}s com menos de ${MIN_GROUP_SIZE} respondentes aparecem juntos em "${OTHERS}".`),
      M, 176, { width: CW, lineGap: 2.5 });
    doc.moveDown(1.2);

    // ---------- questions ----------
    openQuestions.forEach((q, qi) => {
      const answered = withText.filter(r => r.texts[q.id]);
      if (answered.length === 0) return;

      ensureSpace(120);
      const qy = doc.y;
      doc.font(FONT.bold).fontSize(8).fillColor(C.teal).text(`PERGUNTA ${qi + 1} DE ${openQuestions.length}`, M, qy, { characterSpacing: 0.8, width: CW });
      doc.font(FONT.bold).fontSize(14).fillColor(C.ink).text(sanitize(q.text), M, doc.y + 4, { width: CW, lineGap: 2 });
      const meta = `${answered.length} respostas` + (q.context ? ` · pergunta de acompanhamento de: "${q.context}"` : '');
      doc.font(FONT.regular).fontSize(8.5).fillColor(C.muted).text(sanitize(meta), M, doc.y + 3, { width: CW });
      doc.moveTo(M, doc.y + 7).lineTo(W - M, doc.y + 7).lineWidth(1).strokeColor(C.teal).stroke();
      doc.y += 18;

      groupNames.forEach((group) => {
        const texts = answered.filter(r => groupOf(r) === group).map(r => sanitize(r.texts[q.id])).filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        if (texts.length === 0) return;

        ensureSpace(64);
        const gy = doc.y;
        doc.roundedRect(M, gy, CW, 20, 4).fill(C.panel);
        doc.font(FONT.bold).fontSize(9.5).fillColor(C.ink).text(sanitize(group), M + 10, gy + 5.5, { width: CW - 130, height: 11, ellipsis: true });
        doc.font(FONT.regular).fontSize(8).fillColor(C.muted).text(
          `${texts.length} de ${groupSizes.get(group)} responderam`, W - M - 120, gy + 6.5, { width: 110, align: 'right' });
        doc.y = gy + 29;

        texts.forEach((t) => {
          doc.font(FONT.regular).fontSize(10);
          const h = doc.heightOfString(t, { width: CW - 16, lineGap: 2.5 });
          // Keep a paragraph together when it fits on one page
          if (doc.y + h > bottomY && h < bottomY - TOP) doc.addPage();
          const ty = doc.y;
          doc.rect(M + 2, ty + 1, 2, Math.min(h, bottomY - ty) - 3).fill(C.faint);
          doc.fillColor(C.ink).text(t, M + 16, ty, { width: CW - 16, lineGap: 2.5 });
          doc.y += 8;
        });
        doc.y += 8;
      });
      doc.y += 10;
    });

    // ---------- running header / footer ----------
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;   // allow drawing in the footer area without a page break
      if (i > 0) {
        doc.font(FONT.bold).fontSize(7).fillColor(C.teal).text(`TEXTOS POR ${groupLabel.toUpperCase()}`, M, 32, { characterSpacing: 0.6, width: 200, lineBreak: false });
        doc.font(FONT.regular).fontSize(7.5).fillColor(C.muted).text(sanitize(diagnostic.name), M + 200, 32, { width: CW - 200, align: 'right', height: 10, ellipsis: true });
        doc.moveTo(M, 46).lineTo(W - M, 46).lineWidth(0.75).strokeColor(C.faint).stroke();
      }
      doc.moveTo(M, H - 40).lineTo(W - M, H - 40).lineWidth(0.75).strokeColor(C.faint).stroke();
      doc.font(FONT.regular).fontSize(7.5).fillColor(C.muted).text('Confidencial · Uso interno · Contém transcrições literais das respostas', M, H - 32, { width: CW - 60, lineBreak: false });
      doc.text(`${i + 1} / ${range.count}`, W - M - 60, H - 32, { width: 60, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}
