import express from 'express';
import bcrypt from 'bcryptjs';
import { dbGet, dbAll, dbRun, dbQuery } from '../database.js';
import { authenticate, isAdmin } from '../auth.js';

const router = express.Router();

// ==========================================
// DIAGNOSTICS CRUD
// ==========================================

// List all diagnostics (filtered by access for RH users)
router.get('/', authenticate, async (req, res) => {
  try {
    let diagnostics;
    
    if (req.user.role === 'admin') {
      // Admin sees all diagnostics
      diagnostics = await dbAll(`
        SELECT d.*, 
          (SELECT COUNT(*) FROM dimensions WHERE diagnostic_id = d.id) as dimension_count,
          (SELECT COUNT(*) FROM questions q JOIN dimensions dim ON q.dimension_id = dim.id WHERE dim.diagnostic_id = d.id) as question_count,
          (SELECT COUNT(*) FROM responses WHERE diagnostic_id = d.id) as response_count
        FROM diagnostics d 
        ORDER BY d.created_at DESC
      `);
    } else if (req.user.role === 'rh') {
      // RH only sees diagnostics they have access to
      diagnostics = await dbAll(`
        SELECT d.*, 
          (SELECT COUNT(*) FROM dimensions WHERE diagnostic_id = d.id) as dimension_count,
          (SELECT COUNT(*) FROM questions q JOIN dimensions dim ON q.dimension_id = dim.id WHERE dim.diagnostic_id = d.id) as question_count,
          (SELECT COUNT(*) FROM responses WHERE diagnostic_id = d.id) as response_count
        FROM diagnostics d 
        INNER JOIN user_diagnostics_access uda ON d.id = uda.diagnostic_id
        WHERE uda.user_id = $1
        ORDER BY d.created_at DESC
      `, [req.user.id]);
    } else {
      diagnostics = [];
    }
    
    res.json(diagnostics);
  } catch (error) {
    console.error('Erro ao listar diagnósticos:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Get single diagnostic with dimensions and questions
router.get('/:id', authenticate, async (req, res) => {
  try {
    const diagnostic = await dbGet('SELECT * FROM diagnostics WHERE id = $1', [req.params.id]);
    if (!diagnostic) {
      return res.status(404).json({ error: 'Diagnóstico não encontrado' });
    }

    const dimensions = await dbAll(`
      SELECT * FROM dimensions WHERE diagnostic_id = $1 ORDER BY sort_order
    `, [req.params.id]);

    for (const dim of dimensions) {
      dim.questions = await dbAll(`
        SELECT * FROM questions WHERE dimension_id = $1 ORDER BY sort_order
      `, [dim.id]);
    }

    diagnostic.dimensions = dimensions;
    res.json(diagnostic);
  } catch (error) {
    console.error('Erro ao buscar diagnóstico:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Get diagnostic questions for survey (flat list)
router.get('/:id/questions', authenticate, async (req, res) => {
  try {
    const diagnostic = await dbGet('SELECT * FROM diagnostics WHERE id = $1 AND status = $2', [req.params.id, 'active']);
    if (!diagnostic) {
      return res.status(404).json({ error: 'Diagnóstico não encontrado ou inativo' });
    }

    const questions = await dbAll(`
      SELECT q.id, q.text, q.type, q.options, q.inverted, q.required, q.sort_order as q_order, 
             d.id as dimension_id, d.name as dimension_name, d.sort_order as d_order
      FROM questions q
      JOIN dimensions d ON q.dimension_id = d.id
      WHERE d.diagnostic_id = $1
      ORDER BY d.sort_order, q.sort_order
    `, [req.params.id]);

    // Get departments for this diagnostic
    const departments = await dbAll(
      'SELECT id, name FROM departments WHERE diagnostic_id = $1 ORDER BY name',
      [req.params.id]
    );

    res.json({ diagnostic, questions, departments });
  } catch (error) {
    console.error('Erro ao buscar perguntas:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Get departments for a diagnostic
router.get('/:id/departments', authenticate, async (req, res) => {
  try {
    const departments = await dbAll(
      'SELECT * FROM departments WHERE diagnostic_id = $1 ORDER BY name',
      [req.params.id]
    );
    res.json(departments);
  } catch (error) {
    console.error('Erro ao buscar departamentos:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Add department to diagnostic
router.post('/:id/departments', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const result = await dbQuery(
      'INSERT INTO departments (diagnostic_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, name, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar departamento:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Update department
router.put('/departments/:deptId', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const result = await dbQuery(
      'UPDATE departments SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *',
      [name, description, req.params.deptId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Departamento não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar departamento:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Delete department
router.delete('/departments/:deptId', authenticate, isAdmin, async (req, res) => {
  try {
    // Check if has responses
    const responses = await dbGet(
      'SELECT id FROM responses WHERE department_id = $1 LIMIT 1',
      [req.params.deptId]
    );

    if (responses) {
      return res.status(400).json({ error: 'Não é possível excluir departamento com respostas' });
    }

    await dbRun('DELETE FROM departments WHERE id = $1', [req.params.deptId]);
    res.json({ message: 'Departamento excluído' });
  } catch (error) {
    console.error('Erro ao excluir departamento:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Create diagnostic
router.post('/', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description, status = 'draft', is_nr1 = false } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const result = await dbQuery(
      'INSERT INTO diagnostics (name, description, status, is_nr1) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, status, is_nr1]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar diagnóstico:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Update diagnostic
router.put('/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description, status, is_nr1 } = req.body;
    
    const result = await dbQuery(
      'UPDATE diagnostics SET name = COALESCE($1, name), description = COALESCE($2, description), status = COALESCE($3, status), is_nr1 = COALESCE($4, is_nr1), updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [name, description, status, is_nr1, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Diagnóstico não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar diagnóstico:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Delete diagnostic (CASCADE - deletes all related data)
router.delete('/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const diagnosticId = req.params.id;
    
    // Get diagnostic name for logging
    const diagnostic = await dbGet('SELECT name FROM diagnostics WHERE id = $1', [diagnosticId]);
    if (!diagnostic) {
      return res.status(404).json({ error: 'Diagnóstico não encontrado' });
    }
    
    console.log(`[DELETE] Excluindo diagnóstico "${diagnostic.name}" e todos os dados relacionados...`);
    
    // 1. Delete responses for this diagnostic
    const delResponses = await dbQuery('DELETE FROM responses WHERE diagnostic_id = $1 RETURNING id', [diagnosticId]);
    
    // 2. Unlink users from departments of this diagnostic (set department_id to NULL)
    await dbRun(`
      UPDATE users SET department_id = NULL 
      WHERE department_id IN (SELECT id FROM departments WHERE diagnostic_id = $1)
    `, [diagnosticId]);
    
    // 3. Delete test users that ONLY belong to this diagnostic
    const delTestUsers = await dbQuery(`
      DELETE FROM users 
      WHERE (email LIKE '%.teste' OR email LIKE '%@cuidarmais.com.br')
      AND role = 'user'
      AND id IN (SELECT user_id FROM user_diagnostics WHERE diagnostic_id = $1)
      AND id NOT IN (SELECT user_id FROM user_diagnostics WHERE diagnostic_id != $1)
      RETURNING id
    `, [diagnosticId]);
    
    // 4. Delete enrollments for this diagnostic
    const delEnrollments = await dbQuery('DELETE FROM user_diagnostics WHERE diagnostic_id = $1 RETURNING id', [diagnosticId]);
    
    // 5. Delete departments for this diagnostic
    const delDepts = await dbQuery('DELETE FROM departments WHERE diagnostic_id = $1 RETURNING id', [diagnosticId]);
    
    // 6. Delete diagnostic (dimensions and questions cascade automatically)
    await dbRun('DELETE FROM diagnostics WHERE id = $1', [diagnosticId]);
    
    console.log(`[DELETE] Excluído: ${delResponses.rowCount} respostas, ${delTestUsers.rowCount} usuários teste, ${delEnrollments.rowCount} inscrições, ${delDepts.rowCount} departamentos`);
    
    res.json({ 
      message: 'Diagnóstico e todos os dados relacionados excluídos',
      deleted: {
        responses: delResponses.rowCount,
        testUsers: delTestUsers.rowCount,
        enrollments: delEnrollments.rowCount,
        departments: delDepts.rowCount
      }
    });
  } catch (error) {
    console.error('Erro ao excluir diagnóstico:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// DIMENSIONS CRUD
// ==========================================

// Add dimension to diagnostic
router.post('/:id/dimensions', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    // Get next sort order
    const maxOrder = await dbGet('SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM dimensions WHERE diagnostic_id = $1', [req.params.id]);

    const result = await dbQuery(
      'INSERT INTO dimensions (diagnostic_id, name, description, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, name, description, maxOrder.next_order]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar dimensão:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Update dimension
router.put('/dimensions/:dimId', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description, sort_order } = req.body;
    
    const result = await dbQuery(
      'UPDATE dimensions SET name = COALESCE($1, name), description = COALESCE($2, description), sort_order = COALESCE($3, sort_order) WHERE id = $4 RETURNING *',
      [name, description, sort_order, req.params.dimId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dimensão não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar dimensão:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Delete dimension
router.delete('/dimensions/:dimId', authenticate, isAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM dimensions WHERE id = $1', [req.params.dimId]);
    res.json({ message: 'Dimensão excluída' });
  } catch (error) {
    console.error('Erro ao excluir dimensão:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// QUESTIONS CRUD
// ==========================================

// Add question to dimension
router.post('/dimensions/:dimId/questions', authenticate, isAdmin, async (req, res) => {
  try {
    const { text, type = 'likert5', options = null, inverted = false, required = true, is_demographic = false } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Texto é obrigatório' });
    }

    // Get next sort order
    const maxOrder = await dbGet('SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM questions WHERE dimension_id = $1', [req.params.dimId]);

    const result = await dbQuery(
      'INSERT INTO questions (dimension_id, text, type, options, inverted, required, is_demographic, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [req.params.dimId, text, type, options ? JSON.stringify(options) : null, inverted, required, is_demographic || false, maxOrder.next_order]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar pergunta:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Update question
router.put('/questions/:qId', authenticate, isAdmin, async (req, res) => {
  try {
    const { text, type, options, inverted, required, is_demographic, sort_order } = req.body;
    
    const result = await dbQuery(
      `UPDATE questions SET 
        text = COALESCE($1, text), 
        type = COALESCE($2, type),
        options = COALESCE($3, options),
        inverted = COALESCE($4, inverted), 
        required = COALESCE($5, required),
        is_demographic = COALESCE($6, is_demographic),
        sort_order = COALESCE($7, sort_order) 
      WHERE id = $8 RETURNING *`,
      [text, type, options ? JSON.stringify(options) : null, inverted, required, is_demographic, sort_order, req.params.qId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pergunta não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar pergunta:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Delete question
router.delete('/questions/:qId', authenticate, isAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM questions WHERE id = $1', [req.params.qId]);
    res.json({ message: 'Pergunta excluída' });
  } catch (error) {
    console.error('Erro ao excluir pergunta:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// AI GENERATION
// ==========================================

// ==========================================
// IMPORT FROM DOCUMENT
// ==========================================

// Parse document content and return structured diagnostic (preview only, doesn't save)
router.post('/import/parse', authenticate, isAdmin, async (req, res) => {
  try {
    let { content, filename, fileData, fileType } = req.body;

    // If fileData is provided (base64), extract text from PDF
    if (fileData && fileType === 'application/pdf') {
      try {
        // Use createRequire for CommonJS module
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const pdfParse = require('pdf-parse');
        
        const buffer = Buffer.from(fileData, 'base64');
        const pdfData = await pdfParse(buffer);
        content = pdfData.text;
        console.log(`[IMPORT] PDF extracted, ${pdfData.numpages} pages, ${content.length} chars`);
      } catch (pdfErr) {
        console.error('[IMPORT] Erro ao extrair PDF:', pdfErr);
        return res.status(400).json({ 
          error: `Erro ao ler o PDF: ${pdfErr.message}`,
          code: 'PDF_ERROR'
        });
      }
    }

    if (!content) {
      return res.status(400).json({ 
        error: 'Conteúdo do documento é obrigatório',
        code: 'EMPTY_CONTENT'
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[IMPORT] ANTHROPIC_API_KEY não configurada');
      return res.status(500).json({ 
        error: 'Chave da API de IA não configurada. Configure ANTHROPIC_API_KEY no Railway.',
        code: 'NO_API_KEY'
      });
    }

    console.log(`[IMPORT] Processando documento: ${filename || 'sem nome'}, tamanho: ${content.length} chars`);

    // =====================================================
    // STEP 1: PROGRAMMATIC PRE-PROCESSING
    // =====================================================
    const rawLines = content.split('\n').map(l => l.trim()).filter(l => l);
    
    // First pass: join multi-line questions
    // A question might span multiple lines if it doesn't end with ? or : but next line ends with ?
    const lines = [];
    let buffer = '';
    
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const isLikertLine = line.includes('😡') || line.includes('Discordo') || /^●/.test(line);
      const isFieldIndicator = line.includes('CAMPO ABERTO');
      const endsWithQuestion = line.endsWith('?');
      const endsWithColon = line.endsWith(':');
      
      // Skip likert indicators and field markers from joining
      if (isLikertLine || isFieldIndicator) {
        if (buffer) {
          lines.push(buffer);
          buffer = '';
        }
        lines.push(line);
        continue;
      }
      
      // If buffer exists and this line ends with ?, join them
      if (buffer && endsWithQuestion) {
        lines.push(buffer + ' ' + line);
        buffer = '';
      } else if (endsWithQuestion || endsWithColon) {
        if (buffer) {
          lines.push(buffer);
          buffer = '';
        }
        lines.push(line);
      } else {
        // Check if this looks like a continuation (starts lowercase or is short continuation)
        const nextLine = rawLines[i + 1] || '';
        const nextEndsWithQuestion = nextLine.endsWith('?');
        
        if (nextEndsWithQuestion && line.length > 10 && !line.match(/^[A-ZÁÉÍÓÚ]{3,}/)) {
          // This line might be start of a multi-line question
          buffer = line;
        } else {
          if (buffer) {
            lines.push(buffer);
            buffer = '';
          }
          lines.push(line);
        }
      }
    }
    if (buffer) lines.push(buffer);
    
    // Build a structured representation of what we found
    let preProcessed = "CONTEÚDO EXTRAÍDO DO DOCUMENTO (copie exatamente):\n\n";
    
    let currentSection = null;
    let currentQuestion = null;
    let collectingOptions = false;
    let options = [];
    let pendingNPS = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1] || '';
      const nextNextLine = lines[i + 2] || '';
      
      // Detect section headers (ALL CAPS, at least 4 chars, no special chars)
      const isSection = /^[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ\s]{4,}$/.test(line) && !line.includes('●');
      
      // Detect questions - ends with ? OR ends with : followed by short option-like lines
      const endsWithQuestion = line.endsWith('?');
      const endsWithColon = line.endsWith(':');
      
      // Check if line ending with : is followed by what looks like options
      const colonFollowedByOptions = endsWithColon && 
        nextLine.length < 40 && 
        !nextLine.endsWith('?') && 
        !nextLine.endsWith(':') &&
        !nextLine.includes('●') &&
        !nextLine.includes('😡');
      
      const isQuestion = endsWithQuestion || colonFollowedByOptions;
      
      // Detect Likert scale indicators
      const isLikertIndicator = line.includes('😡') || line.includes('Discordo totalmente') || /^●?\s*[1-5]\s*(😡|😟|😐|🙂|😍)/.test(line);
      
      // Detect field type indicators
      const isOpenField = line.includes('CAMPO ABERTO') || line === '(CAMPO ABERTO)';
      const isNPSIndicator = line.toLowerCase().includes('0 a 10') || line.toLowerCase().includes('de 0 a 10');
      
      // Detect simple options (short lines, no ending punctuation, not a header)
      const isOption = line.length < 40 && 
                       !endsWithQuestion && 
                       !line.endsWith('.') && 
                       !endsWithColon &&
                       !isSection && 
                       !isLikertIndicator && 
                       !isOpenField &&
                       !line.startsWith('●') && 
                       !line.startsWith('-') &&
                       !/^[0-9]+[\.\)]\s/.test(line);
      
      if (isSection) {
        // Flush previous question options
        if (currentQuestion && options.length > 0) {
          preProcessed += `  OPÇÕES_EXATAS: ${JSON.stringify(options)}\n`;
          options = [];
        }
        currentSection = line;
        preProcessed += `\n[SEÇÃO]: ${line}\n`;
        collectingOptions = false;
        pendingNPS = false;
      } else if (isQuestion) {
        // Flush previous question options
        if (currentQuestion && options.length > 0) {
          preProcessed += `  OPÇÕES_EXATAS: ${JSON.stringify(options)}\n`;
          options = [];
        }
        currentQuestion = line;
        preProcessed += `  [PERGUNTA]: ${line}\n`;
        
        // Check if NPS question
        if (isNPSIndicator) {
          preProcessed += `  [TIPO]: nps\n`;
          collectingOptions = false;
          pendingNPS = true; // Next question might be the "Porque?" follow-up
        } else {
          collectingOptions = true;
          pendingNPS = false;
        }
      } else if (isOpenField) {
        preProcessed += `  [TIPO]: open\n`;
        collectingOptions = false;
      } else if (isLikertIndicator) {
        preProcessed += `  [TIPO]: likert5\n`;
        collectingOptions = false;
      } else if (line === 'Sim' || line === 'Não') {
        if (!options.includes(line)) options.push(line);
        if (options.includes('Sim') && options.includes('Não') && options.length === 2) {
          preProcessed += `  [TIPO]: yes_no\n`;
          options = [];
          collectingOptions = false;
        }
      } else if (collectingOptions && isOption && currentQuestion) {
        options.push(line);
      }
    }
    
    // Flush last options
    if (options.length > 0) {
      preProcessed += `  OPÇÕES_EXATAS: ${JSON.stringify(options)}\n`;
    }

    console.log('[IMPORT] Pre-processed structure:', preProcessed.substring(0, 1000));

    // =====================================================
    // STEP 2: AI JUST ORGANIZES INTO JSON FORMAT
    // =====================================================
    const systemPrompt = `Você é um formatador de dados. Você recebe dados já extraídos e estruturados e apenas converte para JSON.

REGRAS ABSOLUTAS:
- Use APENAS os dados fornecidos na entrada
- Copie textos EXATAMENTE como aparecem
- Copie opções EXATAMENTE como listadas em OPÇÕES_EXATAS
- NUNCA adicione, invente ou modifique dados
- Se OPÇÕES_EXATAS tem ["Feminino", "Masculino"], o JSON deve ter exatamente isso
- Você é um FORMATADOR, não um criador`;

    const userPrompt = `Converta estes dados já extraídos para o formato JSON.

${preProcessed}

DOCUMENTO ORIGINAL PARA REFERÊNCIA (use para pegar o título e verificar):
"""
${content.substring(0, 3000)}
"""

Gere o JSON no formato (sem markdown, apenas JSON):
{
  "name": "primeiro título ou nome do diagnóstico encontrado no documento",
  "description": "",
  "dimensions": [
    {
      "name": "nome da [SEÇÃO]",
      "questions": [
        {
          "text": "texto da [PERGUNTA]",
          "type": "tipo indicado ou single_choice se tem OPÇÕES_EXATAS",
          "inverted": true se pergunta negativa,
          "options": array de OPÇÕES_EXATAS ou null
        }
      ]
    }
  ]
}

Para type:
- Se [TIPO]: likert5 → "likert5"
- Se [TIPO]: nps → "nps"  
- Se [TIPO]: yes_no → "yes_no"
- Se [TIPO]: open → "open"
- Se tem OPÇÕES_EXATAS (e não é yes_no) → "single_choice" com options copiando exatamente o array

JSON:`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[IMPORT] Erro na API Anthropic:', response.status, errorText);
      
      if (response.status === 401) {
        return res.status(500).json({ 
          error: 'Chave da API de IA inválida. Verifique ANTHROPIC_API_KEY.',
          code: 'INVALID_API_KEY'
        });
      }
      if (response.status === 429) {
        return res.status(429).json({ 
          error: 'Limite de requisições da IA atingido. Aguarde alguns minutos.',
          code: 'RATE_LIMIT'
        });
      }
      if (response.status === 529) {
        return res.status(503).json({ 
          error: 'Serviço de IA temporariamente sobrecarregado. Tente novamente em alguns segundos.',
          code: 'SERVICE_OVERLOADED'
        });
      }
      return res.status(500).json({ 
        error: `Erro ao processar documento com IA (${response.status})`,
        code: 'AI_ERROR'
      });
    }

    const data = await response.json();
    const responseContent = data.content[0].text;
    
    console.log(`[IMPORT] Resposta da IA recebida, tamanho: ${responseContent.length} chars`);
    console.log(`[IMPORT] Primeiros 500 chars:`, responseContent.substring(0, 500));
    
    // Parse JSON response with multiple fallback strategies
    let parsed;
    try {
      let jsonStr = responseContent.trim();
      
      // Strategy 1: Remove markdown code blocks
      if (jsonStr.includes('```')) {
        jsonStr = jsonStr.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
      }
      
      // Strategy 2: Find JSON object in the response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      
      // Strategy 3: Clean up common issues
      jsonStr = jsonStr.trim();
      
      // Try to parse
      parsed = JSON.parse(jsonStr);
      
    } catch (e) {
      console.error('[IMPORT] Erro ao parsear JSON da IA:', e.message);
      console.error('[IMPORT] Resposta completa:', responseContent);
      
      // Try one more time - maybe there's text before/after the JSON
      try {
        const lastTry = responseContent.match(/\{[\s\S]*"dimensions"[\s\S]*\}/);
        if (lastTry) {
          parsed = JSON.parse(lastTry[0]);
          console.log('[IMPORT] Conseguiu parsear na segunda tentativa');
        } else {
          throw new Error('Não encontrou estrutura JSON válida');
        }
      } catch (e2) {
        return res.status(500).json({ 
          error: 'Erro ao interpretar documento. A IA não retornou um formato válido. Tente novamente.',
          code: 'PARSE_ERROR',
          debug: responseContent.substring(0, 300)
        });
      }
    }

    console.log(`[IMPORT] Diagnóstico parseado: ${parsed.name}, ${parsed.dimensions?.length} dimensões`);

    // Return parsed structure for preview (NOT saved yet)
    res.json({
      success: true,
      diagnostic: parsed,
      summary: {
        dimensions: parsed.dimensions?.length || 0,
        questions: parsed.dimensions?.reduce((sum, d) => sum + (d.questions?.length || 0), 0) || 0,
        npsQuestions: parsed.dimensions?.reduce((sum, d) => sum + (d.questions?.filter(q => q.type === 'nps').length || 0), 0) || 0,
        openQuestions: parsed.dimensions?.reduce((sum, d) => sum + (d.questions?.filter(q => q.type === 'open').length || 0), 0) || 0,
        choiceQuestions: parsed.dimensions?.reduce((sum, d) => sum + (d.questions?.filter(q => q.type === 'single_choice').length || 0), 0) || 0
      }
    });

  } catch (error) {
    console.error('[IMPORT] Erro inesperado:', error);
    res.status(500).json({ 
      error: `Erro interno ao importar documento: ${error.message}`,
      code: 'INTERNAL_ERROR'
    });
  }
});

// Create diagnostic from imported/previewed data
router.post('/import/create', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description, dimensions, status = 'draft', is_nr1 = false } = req.body;

    if (!name || !dimensions || dimensions.length === 0) {
      return res.status(400).json({ 
        error: 'Nome e dimensões são obrigatórios',
        code: 'MISSING_DATA'
      });
    }

    console.log(`[IMPORT] Criando diagnóstico: ${name}, ${dimensions.length} dimensões`);

    // Create diagnostic
    const diagResult = await dbQuery(
      'INSERT INTO diagnostics (name, description, status, is_nr1) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description || '', status, is_nr1]
    );
    const diagnostic = diagResult.rows[0];

    // Create dimensions and questions
    let dimOrder = 0;
    for (const dim of dimensions) {
      const dimResult = await dbQuery(
        'INSERT INTO dimensions (diagnostic_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *',
        [diagnostic.id, dim.name, dimOrder++]
      );
      const dimension = dimResult.rows[0];

      // Check if this dimension looks like demographic data
      const isDemographicDimension = /dados|demogr|perfil|identifica/i.test(dim.name);

      let qOrder = 0;
      for (const q of dim.questions || []) {
        // Auto-detect demographic questions
        const isDemographic = q.is_demographic || 
          (isDemographicDimension && q.type === 'single_choice') ||
          /sexo|gênero|genero|cargo|função|funcao|unidade|setor|idade|tempo.*empresa|escolaridade/i.test(q.text);
        
        await dbQuery(
          'INSERT INTO questions (dimension_id, text, type, options, inverted, is_demographic, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            dimension.id, 
            q.text, 
            q.type || 'likert5',
            q.options ? JSON.stringify(q.options) : null,
            q.inverted || false,
            isDemographic,
            qOrder++
          ]
        );
      }
    }

    // Return complete diagnostic
    const completeDiagnostic = await dbGet('SELECT * FROM diagnostics WHERE id = $1', [diagnostic.id]);
    const dims = await dbAll('SELECT * FROM dimensions WHERE diagnostic_id = $1 ORDER BY sort_order', [diagnostic.id]);
    
    for (const dim of dims) {
      dim.questions = await dbAll('SELECT * FROM questions WHERE dimension_id = $1 ORDER BY sort_order', [dim.id]);
    }
    
    completeDiagnostic.dimensions = dims;
    
    console.log(`[IMPORT] Diagnóstico criado com sucesso: ID ${completeDiagnostic.id}`);
    res.status(201).json(completeDiagnostic);

  } catch (error) {
    console.error('[IMPORT] Erro ao criar diagnóstico:', error);
    res.status(500).json({ 
      error: `Erro ao salvar diagnóstico: ${error.message}`,
      code: 'DB_ERROR'
    });
  }
});

// ==========================================
// AI GENERATE
// ==========================================

router.post('/generate', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, objective, examples, questionCount = 20, dimensionCount = 5, is_nr1 = false } = req.body;

    if (!name || !objective) {
      return res.status(400).json({ error: 'Nome e objetivo são obrigatórios' });
    }

    // Call Claude API to generate diagnostic
    const prompt = `Você é um especialista em RH e psicologia organizacional. Crie um diagnóstico empresarial com o seguinte tema:

TEMA: ${name}

OBJETIVO: ${objective}

${examples ? `EXEMPLOS DE PERGUNTAS QUE O CLIENTE GOSTARIA (use como inspiração):\n${examples}\n` : ''}

REQUISITOS:
- Crie exatamente ${dimensionCount} dimensões
- Crie um total de ${questionCount} perguntas distribuídas entre as dimensões
- Cada pergunta deve ser respondida em escala Likert de 1-5 (Discordo totalmente a Concordo totalmente)
- Identifique perguntas invertidas (onde concordar indica algo negativo)
- As perguntas devem ser claras, objetivas e em português brasileiro

Responda APENAS com um JSON válido neste formato exato (sem texto adicional, sem markdown):
{
  "description": "Descrição do diagnóstico em 1-2 frases",
  "dimensions": [
    {
      "name": "Nome da Dimensão",
      "questions": [
        { "text": "Texto da pergunta", "inverted": false },
        { "text": "Outra pergunta (invertida significa negativa)", "inverted": true }
      ]
    }
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erro na API Anthropic:', response.status, errorText);
      
      if (response.status === 401) {
        return res.status(500).json({ error: 'Chave da API de IA inválida' });
      }
      if (response.status === 429) {
        return res.status(429).json({ error: 'Limite de requisições da IA atingido. Aguarde alguns minutos.' });
      }
      if (response.status === 529) {
        return res.status(503).json({ error: 'Serviço de IA temporariamente sobrecarregado. Tente novamente em alguns segundos.' });
      }
      return res.status(500).json({ error: 'Erro ao gerar diagnóstico com IA' });
    }

    const data = await response.json();
    const content = data.content[0].text;
    
    // Parse JSON response
    let generated;
    try {
      generated = JSON.parse(content);
    } catch (e) {
      console.error('Erro ao parsear resposta da IA:', content);
      return res.status(500).json({ error: 'Erro ao processar resposta da IA' });
    }

    // Save to database
    const diagResult = await dbQuery(
      'INSERT INTO diagnostics (name, description, status, is_nr1) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, generated.description, 'draft', is_nr1]
    );
    const diagnostic = diagResult.rows[0];

    // Create dimensions and questions
    let dimOrder = 0;
    for (const dim of generated.dimensions) {
      const dimResult = await dbQuery(
        'INSERT INTO dimensions (diagnostic_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *',
        [diagnostic.id, dim.name, dimOrder++]
      );
      const dimension = dimResult.rows[0];

      let qOrder = 0;
      for (const q of dim.questions) {
        await dbQuery(
          'INSERT INTO questions (dimension_id, text, inverted, sort_order) VALUES ($1, $2, $3, $4)',
          [dimension.id, q.text, q.inverted || false, qOrder++]
        );
      }
    }

    // Return complete diagnostic
    const completeDiagnostic = await dbGet('SELECT * FROM diagnostics WHERE id = $1', [diagnostic.id]);
    const dimensions = await dbAll('SELECT * FROM dimensions WHERE diagnostic_id = $1 ORDER BY sort_order', [diagnostic.id]);
    
    for (const dim of dimensions) {
      dim.questions = await dbAll('SELECT * FROM questions WHERE dimension_id = $1 ORDER BY sort_order', [dim.id]);
    }
    
    completeDiagnostic.dimensions = dimensions;

    res.status(201).json(completeDiagnostic);
  } catch (error) {
    console.error('Erro ao gerar diagnóstico:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// ENROLLMENT MANAGEMENT
// ==========================================

// Brazilian first names and last names for realistic test data
const FIRST_NAMES = [
  'Ana', 'Maria', 'João', 'Pedro', 'Lucas', 'Gabriel', 'Rafael', 'Bruno', 'Carlos', 'Daniel',
  'Felipe', 'Gustavo', 'Henrique', 'Igor', 'Julia', 'Larissa', 'Mariana', 'Natalia', 'Patricia', 'Renata',
  'Sergio', 'Thiago', 'Vanessa', 'William', 'Amanda', 'Beatriz', 'Camila', 'Diego', 'Eduardo', 'Fernanda',
  'Guilherme', 'Helena', 'Isabela', 'José', 'Karen', 'Leonardo', 'Marcelo', 'Nicolas', 'Olivia', 'Paulo',
  'Ricardo', 'Sandra', 'Tatiana', 'Vitor', 'Yasmin', 'André', 'Bianca', 'Cristina', 'Douglas', 'Elisa'
];

const LAST_NAMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes',
  'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa',
  'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas',
  'Cardoso', 'Ramos', 'Gonçalves', 'Santana', 'Teixeira', 'Araújo', 'Pinto', 'Correia', 'Batista', 'Monteiro'
];

// Generate random number with normal distribution (Box-Muller transform)
function randomNormal(mean = 3.5, stdDev = 1.0) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

// Generate a score between 1 and 5 with normal distribution
function generateScore(baseMean = 3.5, dimensionBias = 0, deptBias = 0) {
  const mean = baseMean + dimensionBias + deptBias;
  const score = Math.round(randomNormal(mean, 0.8));
  return Math.max(1, Math.min(5, score)); // Clamp between 1-5
}

// Sample open-ended responses for different types of questions
const OPEN_RESPONSES = {
  positive: [
    "Muito bom, estou satisfeito com o ambiente de trabalho.",
    "A equipe é muito colaborativa e prestativa.",
    "Gosto do clima organizacional aqui.",
    "O suporte da liderança é excelente.",
    "Me sinto valorizado como profissional.",
    "As oportunidades de crescimento são boas.",
    "A comunicação entre as equipes funciona bem.",
    "Excelente lugar para trabalhar!",
    "Minha liderança é muito atenciosa e justa.",
  ],
  neutral: [
    "Está ok, mas poderia melhorar.",
    "Algumas coisas funcionam bem, outras nem tanto.",
    "É um ambiente normal de trabalho.",
    "Não tenho muitas reclamações, mas também não é excepcional.",
    "Poderia ser melhor em alguns aspectos.",
    "Nada a declarar no momento.",
    "Sem comentários adicionais.",
  ],
  negative: [
    "Falta comunicação clara da liderança.",
    "Precisamos de mais investimento em treinamento.",
    "O clima poderia ser mais colaborativo.",
    "As escalas mudam muito em cima da hora.",
    "Falta reconhecimento pelo trabalho realizado.",
    "A carga de trabalho está muito pesada.",
    "Precisamos de mais flexibilidade nos horários.",
    "A gestão precisa ouvir mais os colaboradores.",
    "Muita pressão e pouco suporte.",
    "Não me sinto valorizado aqui.",
  ],
  suggestions: [
    "Mais treinamentos e capacitações.",
    "Melhorar a comunicação interna.",
    "Criar mais momentos de integração da equipe.",
    "Investir em equipamentos e infraestrutura.",
    "Rever a política de benefícios.",
    "Criar um plano de carreira mais claro.",
    "Melhorar o ambiente físico de trabalho.",
    "Mais flexibilidade de horários.",
    "Aumentar o quadro de funcionários.",
    "Melhorar os salários.",
  ]
};

// Generate answer based on question type with department sentiment
function generateAnswerForType(question, deptSentiment, dimSentiment, personalVariation) {
  const type = question.type || 'likert5';
  
  // Combined sentiment: dimension has highest weight for radar variation
  // department: 30%, dimension: 50%, personal: 20%
  const totalSentiment = deptSentiment * 0.3 + dimSentiment * 0.5 + personalVariation * 0.2;
  
  switch (type) {
    case 'likert5': {
      // Base mean varies from 1.75 (very negative) to 4.75 (very positive)
      const baseMean = 3.25 + totalSentiment * 1.5;
      const score = Math.round(randomNormal(baseMean, 0.8));
      return Math.max(1, Math.min(5, score));
    }
    
    case 'likert10': {
      // Base mean varies from 4 (negative) to 9 (positive)
      const baseMean = 6.5 + totalSentiment * 2.5;
      const score = Math.round(randomNormal(baseMean, 1.5));
      return Math.max(0, Math.min(10, score));
    }
    
    case 'nps': {
      // NPS varies based on sentiment, but more realistic ranges
      const rand = Math.random();
      
      // Probabilities shift based on sentiment (-1 to +1)
      // At sentiment -1: 35% detractors, 35% neutral, 30% promoters (bad but not catastrophic)
      // At sentiment 0:  20% detractors, 30% neutral, 50% promoters (normal)
      // At sentiment +1: 10% detractors, 20% neutral, 70% promoters (great)
      const detractorProb = 0.20 - totalSentiment * 0.10; // 10% to 30%
      const neutralProb = 0.30 - totalSentiment * 0.05;   // 25% to 35%
      
      if (rand < detractorProb) {
        // Detractors (0-6) - more likely 4-6 than 0-3
        return Math.max(0, Math.min(6, Math.round(randomNormal(5, 1.5))));
      } else if (rand < detractorProb + neutralProb) {
        // Neutrals (7-8)
        return 7 + Math.floor(Math.random() * 2);
      } else {
        // Promoters (9-10)
        return 9 + Math.floor(Math.random() * 2);
      }
    }
    
    case 'yes_no': {
      // Yes probability varies from 40% (negative) to 80% (positive)
      const yesProb = 0.60 + totalSentiment * 0.20;
      return Math.random() < yesProb ? 1 : 0;
    }
    
    case 'single_choice': {
      // Random selection from options (no sentiment bias - demographic)
      let options = question.options;
      if (typeof options === 'string') {
        try { options = JSON.parse(options); } catch (e) { options = []; }
      }
      if (options && options.length > 0) {
        return options[Math.floor(Math.random() * options.length)];
      }
      return null;
    }
    
    case 'multiple_choice': {
      // Select 1-3 random options
      let mcOptions = question.options;
      if (typeof mcOptions === 'string') {
        try { mcOptions = JSON.parse(mcOptions); } catch (e) { mcOptions = []; }
      }
      if (mcOptions && mcOptions.length > 0) {
        const numToSelect = Math.min(mcOptions.length, Math.floor(Math.random() * 3) + 1);
        const shuffled = [...mcOptions].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, numToSelect);
      }
      return [];
    }
    
    case 'open': {
      // Generate open-ended response based on sentiment
      // 40% chance to skip (not everyone fills open questions)
      if (Math.random() < 0.4) {
        return '';
      }
      
      let responses;
      if (totalSentiment > 0.3) {
        responses = OPEN_RESPONSES.positive;
      } else if (totalSentiment < -0.3) {
        responses = OPEN_RESPONSES.negative;
      } else {
        responses = OPEN_RESPONSES.neutral;
      }
      
      // 25% chance to add a suggestion instead
      if (Math.random() < 0.25) {
        return OPEN_RESPONSES.suggestions[Math.floor(Math.random() * OPEN_RESPONSES.suggestions.length)];
      }
      
      return responses[Math.floor(Math.random() * responses.length)];
    }
    
    default:
      return generateScore(3.5, totalSentiment, 0);
  }
}

// Generate test data for a diagnostic
router.post('/:id/generate-test-data', authenticate, isAdmin, async (req, res) => {
  try {
    const { count = 50 } = req.body;
    const diagnosticId = req.params.id;
    
    // Validate count
    if (count < 10 || count > 500) {
      return res.status(400).json({ error: 'Quantidade deve ser entre 10 e 500' });
    }

    // Get diagnostic
    const diagnostic = await dbGet('SELECT * FROM diagnostics WHERE id = $1', [diagnosticId]);
    if (!diagnostic) {
      return res.status(404).json({ error: 'Diagnóstico não encontrado' });
    }

    // Get questions for this diagnostic (including type and options)
    const questions = await dbAll(`
      SELECT q.id, q.inverted, q.type, q.options, d.id as dimension_id, d.name as dimension_name
      FROM questions q
      JOIN dimensions d ON q.dimension_id = d.id
      WHERE d.diagnostic_id = $1
      ORDER BY d.sort_order, q.sort_order
    `, [diagnosticId]);

    if (questions.length === 0) {
      return res.status(400).json({ error: 'Diagnóstico não tem perguntas' });
    }

    // Get departments for THIS diagnostic
    let departments = await dbAll('SELECT id, name FROM departments WHERE diagnostic_id = $1 ORDER BY id', [diagnosticId]);
    
    // If no departments exist, create some automatically
    if (departments.length === 0) {
      console.log('[TEST-DATA] Criando departamentos automaticamente...');
      
      // Common department names for Brazilian companies
      const defaultDepts = [
        'Administrativo',
        'Comercial', 
        'Operações',
        'Atendimento',
        'Produção'
      ];
      
      // Randomly select 3-5 departments
      const numDepts = 3 + Math.floor(Math.random() * 3); // 3 to 5
      const shuffled = defaultDepts.sort(() => Math.random() - 0.5);
      const selectedDepts = shuffled.slice(0, numDepts);
      
      for (const deptName of selectedDepts) {
        await dbRun(
          'INSERT INTO departments (diagnostic_id, name) VALUES ($1, $2)',
          [diagnosticId, deptName]
        );
      }
      
      // Reload departments
      departments = await dbAll('SELECT id, name FROM departments WHERE diagnostic_id = $1 ORDER BY id', [diagnosticId]);
      console.log(`[TEST-DATA] ${departments.length} departamentos criados:`, departments.map(d => d.name).join(', '));
    }
    
    // Generate RANDOM sentiment for each department (-1 to +1)
    // This creates varied scenarios: some depts happy, some unhappy
    const deptSentiments = {};
    departments.forEach(dept => {
      // Random sentiment from -0.8 to +0.8
      deptSentiments[dept.id] = (Math.random() - 0.5) * 1.6;
    });
    
    // Generate RANDOM sentiment for each dimension with HIGH VARIANCE
    // This ensures dimensions have noticeably different scores in the radar chart
    const uniqueDimensions = [...new Set(questions.map(q => q.dimension_id))];
    const dimSentiments = {};
    uniqueDimensions.forEach(dimId => {
      // Full range -1.0 to +1.0 for more visible differences in radar
      dimSentiments[dimId] = (Math.random() - 0.5) * 2.0;
    });

    console.log('[TEST-DATA] Department sentiments:', 
      departments.map(d => `${d.name}: ${deptSentiments[d.id].toFixed(2)}`).join(', '));
    console.log('[TEST-DATA] Dimension sentiments:', 
      Object.entries(dimSentiments).map(([id, s]) => `${id}: ${s.toFixed(2)}`).join(', '));

    // Create non-proportional distribution for departments
    // Some departments will have more users than others
    const deptWeights = departments.map(() => Math.random() * 2 + 0.5); // 0.5 to 2.5
    const totalWeight = deptWeights.reduce((a, b) => a + b, 0);
    const deptDistribution = deptWeights.map(w => Math.round((w / totalWeight) * count));
    
    // Adjust to match exact count
    let diff = count - deptDistribution.reduce((a, b) => a + b, 0);
    while (diff !== 0) {
      const idx = Math.floor(Math.random() * departments.length);
      if (diff > 0) {
        deptDistribution[idx]++;
        diff--;
      } else if (deptDistribution[idx] > 1) {
        deptDistribution[idx]--;
        diff++;
      }
    }

    const hashedPassword = bcrypt.hashSync('teste123', 10);
    const usedEmails = new Set();
    let createdUsers = 0;
    let createdResponses = 0;

    // Load ALL existing emails from DB to avoid duplicates
    const existingEmails = await dbAll('SELECT email FROM users');
    existingEmails.forEach(u => usedEmails.add(u.email));
    console.log(`[TEST-DATA] ${existingEmails.length} emails já existentes no banco`);

    // Generate users and responses for each department
    
    // Create email domain from diagnostic name
    // "Casa da Sobremesa" -> "casadasobremesa"
    // "Diagnóstico NR-1" -> "diagnosticonr1"
    const emailDomain = diagnostic.name
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9]/g, '') // Remove special chars
      .substring(0, 20) // Limit length
      + '.teste';
    
    console.log(`[TEST-DATA] Usando domínio de e-mail: @${emailDomain}`);
    
    for (let deptIdx = 0; deptIdx < departments.length; deptIdx++) {
      const dept = departments[deptIdx];
      const usersInDept = deptDistribution[deptIdx];

      for (let i = 0; i < usersInDept; i++) {
        // Generate unique name
        let firstName, lastName, email;
        let attempts = 0;
        do {
          firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
          lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
          const suffix = attempts > 0 ? `${attempts}` : '';
          email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${suffix}@${emailDomain}`
            .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove accents
          attempts++;
        } while (usedEmails.has(email) && attempts < 100);

        if (usedEmails.has(email)) continue;
        usedEmails.add(email);

        const fullName = `${firstName} ${lastName}`;

        // Create user
        const userResult = await dbQuery(
          'INSERT INTO users (email, password, name, role, department_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [email, hashedPassword, fullName, 'user', dept.id]
        );
        const userId = userResult.rows[0].id;
        createdUsers++;

        // Enroll user in diagnostic
        await dbRun(
          'INSERT INTO user_diagnostics (user_id, diagnostic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, diagnosticId]
        );

        // Each person has their own variation (-0.5 to +0.5)
        const personalVariation = (Math.random() - 0.5) * 1.0;

        // Generate answers based on question types
        const answers = {};
        const openAnswers = {};
        
        questions.forEach(q => {
          const deptSentiment = deptSentiments[dept.id];
          const dimSentiment = dimSentiments[q.dimension_id];
          const answer = generateAnswerForType(q, deptSentiment, dimSentiment, personalVariation);
          
          // Open questions go to openAnswers, others to answers
          if (q.type === 'open') {
            if (answer) openAnswers[q.id] = answer;
          } else {
            answers[q.id] = answer;
          }
        });

        // Create response
        await dbRun(
          'INSERT INTO responses (user_id, department_id, diagnostic_id, answers, open_answers) VALUES ($1, $2, $3, $4, $5)',
          [userId, dept.id, diagnosticId, JSON.stringify(answers), JSON.stringify(openAnswers)]
        );
        createdResponses++;
      }
    }

    res.json({ 
      message: `Dados de teste gerados com sucesso`,
      created: {
        users: createdUsers,
        responses: createdResponses,
        departments: departments.length
      }
    });
  } catch (error) {
    console.error('[TEST-DATA] Erro:', error);
    res.status(500).json({ 
      error: `Erro ao gerar dados de teste: ${error.message}`,
      code: 'TEST_DATA_ERROR',
      details: error.stack?.split('\n')[1]?.trim()
    });
  }
});

// Clear test data for a diagnostic
router.delete('/:id/test-data', authenticate, isAdmin, async (req, res) => {
  try {
    const diagnosticId = req.params.id;

    // Delete responses from test users (old pattern @cuidarmais.com.br and new pattern .teste)
    await dbRun(`
      DELETE FROM responses 
      WHERE diagnostic_id = $1 
      AND user_id IN (SELECT id FROM users WHERE (email LIKE '%@cuidarmais.com.br' OR email LIKE '%.teste') AND role = 'user')
    `, [diagnosticId]);

    // Delete test users
    const result = await dbQuery(`
      DELETE FROM users 
      WHERE (email LIKE '%@cuidarmais.com.br' OR email LIKE '%.teste')
      AND role = 'user'
      AND id IN (SELECT user_id FROM user_diagnostics WHERE diagnostic_id = $1)
      RETURNING id
    `, [diagnosticId]);

    res.json({ 
      message: 'Dados de teste removidos',
      deleted: result.rows.length
    });
  } catch (error) {
    console.error('Erro ao limpar dados de teste:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Get enrolled users for a diagnostic
router.get('/:id/enrollments', authenticate, isAdmin, async (req, res) => {
  try {
    const enrollments = await dbAll(`
      SELECT u.id, u.name, u.email, d.name as department_name, ud.enrolled_at,
        CASE WHEN r.id IS NOT NULL THEN true ELSE false END as has_responded
      FROM user_diagnostics ud
      JOIN users u ON ud.user_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN responses r ON r.user_id = u.id AND r.diagnostic_id = ud.diagnostic_id
      WHERE ud.diagnostic_id = $1
      ORDER BY u.name
    `, [req.params.id]);
    
    res.json(enrollments);
  } catch (error) {
    console.error('Erro ao buscar inscrições:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Get available users (not enrolled) for a diagnostic
router.get('/:id/available-users', authenticate, isAdmin, async (req, res) => {
  try {
    // Only show users that belong to this diagnostic and are not yet enrolled
    const users = await dbAll(`
      SELECT u.id, u.name, u.email, d.id as department_id, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.role = 'user'
        AND u.diagnostic_id = $1
        AND u.id NOT IN (
          SELECT user_id FROM user_diagnostics WHERE diagnostic_id = $1
        )
      ORDER BY d.name, u.name
    `, [req.params.id]);
    
    res.json(users);
  } catch (error) {
    console.error('Erro ao buscar usuários disponíveis:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Enroll users in a diagnostic
router.post('/:id/enroll', authenticate, isAdmin, async (req, res) => {
  try {
    const { user_ids, department_id } = req.body;
    const diagnosticId = req.params.id;
    
    let usersToEnroll = [];
    
    if (department_id) {
      // Enroll all users from department
      const deptUsers = await dbAll(
        "SELECT id FROM users WHERE department_id = $1 AND role = 'user'",
        [department_id]
      );
      usersToEnroll = deptUsers.map(u => u.id);
    } else if (user_ids && user_ids.length > 0) {
      usersToEnroll = user_ids;
    } else {
      return res.status(400).json({ error: 'Informe user_ids ou department_id' });
    }
    
    let enrolled = 0;
    for (const userId of usersToEnroll) {
      try {
        await dbRun(
          'INSERT INTO user_diagnostics (user_id, diagnostic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, diagnosticId]
        );
        enrolled++;
      } catch (e) {
        // Skip duplicates
      }
    }
    
    res.json({ message: `${enrolled} usuário(s) inscrito(s)`, enrolled });
  } catch (error) {
    console.error('Erro ao inscrever usuários:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Enroll all users
router.post('/:id/enroll-all', authenticate, isAdmin, async (req, res) => {
  try {
    // Only enroll users that belong to this diagnostic
    const result = await dbQuery(`
      INSERT INTO user_diagnostics (user_id, diagnostic_id)
      SELECT id, $1 FROM users WHERE role = 'user' AND diagnostic_id = $1
      ON CONFLICT (user_id, diagnostic_id) DO NOTHING
    `, [req.params.id]);
    
    res.json({ message: 'Todos os colaboradores do diagnóstico inscritos' });
  } catch (error) {
    console.error('Erro ao inscrever todos:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Remove enrollment
router.delete('/:id/enroll/:userId', authenticate, isAdmin, async (req, res) => {
  try {
    // Check if user has already responded
    const response = await dbGet(
      'SELECT id FROM responses WHERE user_id = $1 AND diagnostic_id = $2',
      [req.params.userId, req.params.id]
    );
    
    if (response) {
      return res.status(400).json({ error: 'Não é possível remover usuário que já respondeu' });
    }
    
    await dbRun(
      'DELETE FROM user_diagnostics WHERE user_id = $1 AND diagnostic_id = $2',
      [req.params.userId, req.params.id]
    );
    
    res.json({ message: 'Inscrição removida' });
  } catch (error) {
    console.error('Erro ao remover inscrição:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// RH ACCESS MANAGEMENT
// ==========================================

// List RH users with access to a diagnostic
router.get('/:id/access', authenticate, isAdmin, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.name, u.email, uda.created_at as access_granted_at
      FROM users u
      INNER JOIN user_diagnostics_access uda ON u.id = uda.user_id
      WHERE uda.diagnostic_id = $1 AND u.role = 'rh'
      ORDER BY u.name
    `, [req.params.id]);
    
    res.json(users);
  } catch (error) {
    console.error('Erro ao listar acessos:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// List RH users without access to a diagnostic
router.get('/:id/access/available', authenticate, isAdmin, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.name, u.email
      FROM users u
      WHERE u.role = 'rh' 
      AND u.id NOT IN (
        SELECT user_id FROM user_diagnostics_access WHERE diagnostic_id = $1
      )
      ORDER BY u.name
    `, [req.params.id]);
    
    res.json(users);
  } catch (error) {
    console.error('Erro ao listar RHs disponíveis:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Grant access to RH user
router.post('/:id/access', authenticate, isAdmin, async (req, res) => {
  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id é obrigatório' });
    }
    
    // Check if user is RH
    const user = await dbGet('SELECT id, role FROM users WHERE id = $1', [user_id]);
    if (!user || user.role !== 'rh') {
      return res.status(400).json({ error: 'Usuário não é RH' });
    }
    
    // Check if already has access
    const existing = await dbGet(
      'SELECT id FROM user_diagnostics_access WHERE user_id = $1 AND diagnostic_id = $2',
      [user_id, req.params.id]
    );
    
    if (existing) {
      return res.status(400).json({ error: 'Usuário já tem acesso' });
    }
    
    await dbRun(
      'INSERT INTO user_diagnostics_access (user_id, diagnostic_id) VALUES ($1, $2)',
      [user_id, req.params.id]
    );
    
    res.status(201).json({ message: 'Acesso concedido' });
  } catch (error) {
    console.error('Erro ao conceder acesso:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Revoke access from RH user
router.delete('/:id/access/:userId', authenticate, isAdmin, async (req, res) => {
  try {
    await dbRun(
      'DELETE FROM user_diagnostics_access WHERE user_id = $1 AND diagnostic_id = $2',
      [req.params.userId, req.params.id]
    );
    
    res.json({ message: 'Acesso removido' });
  } catch (error) {
    console.error('Erro ao remover acesso:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

export default router;
