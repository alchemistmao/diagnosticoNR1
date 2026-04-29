import express from 'express';
import { dbGet, dbAll, dbRun, dbQuery } from '../database.js';
import { authenticate, isAdminOrRH } from '../auth.js';

const router = express.Router();

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Question types that contribute to score calculation
const SCORABLE_TYPES = ['likert5', 'likert10', 'yes_no'];

// Fetch questions for a diagnostic from database
async function getQuestionsForDiagnostic(diagnosticId) {
  const questions = await dbAll(`
    SELECT q.id, q.text, q.type, q.options, q.inverted, q.required, q.sort_order as q_order,
           d.id as dimension_id, d.name as dimension_name, d.sort_order as d_order
    FROM questions q
    JOIN dimensions d ON q.dimension_id = d.id
    WHERE d.diagnostic_id = $1
    ORDER BY d.sort_order, q.sort_order
  `, [diagnosticId]);
  
  return questions.map((q, index) => ({
    id: q.id,
    index: index + 1,
    dimension: q.dimension_name,
    dimension_id: q.dimension_id,
    type: q.type || 'likert5',
    options: q.options,
    inverted: q.inverted,
    required: q.required,
    text: q.text
  }));
}

// Get default (first active) diagnostic
async function getDefaultDiagnostic() {
  return await dbGet("SELECT id FROM diagnostics WHERE status = 'active' ORDER BY id LIMIT 1");
}

// Normalize score to 1-5 scale based on question type
function normalizeScore(value, type, inverted) {
  let score;
  
  switch (type) {
    case 'likert5':
      score = value;
      break;
    case 'likert10':
    case 'nps':
      // Convert 0-10 to 1-5 scale
      score = (value / 10) * 4 + 1;
      break;
    case 'yes_no':
      // Yes = 5, No = 1
      score = value === 1 || value === true || value === 'yes' ? 5 : 1;
      break;
    default:
      return null; // Non-scorable type
  }
  
  return inverted ? 6 - score : score;
}

function calculateScore(answers, questions) {
  const answerObj = typeof answers === 'string' ? JSON.parse(answers) : answers;
  let total = 0, count = 0;
  
  questions.forEach((q) => {
    if (!SCORABLE_TYPES.includes(q.type)) return;
    
    const answerValue = answerObj[q.id];
    if (answerValue !== undefined && answerValue !== null) {
      const score = normalizeScore(answerValue, q.type, q.inverted);
      if (score !== null) {
        total += score;
        count++;
      }
    }
  });
  
  return count > 0 ? total / count : 0;
}

function calculateDimensionScores(responses, questions) {
  // Get dimensions that have scorable questions
  const scorableQuestions = questions.filter(q => SCORABLE_TYPES.includes(q.type));
  const dimensions = [...new Set(scorableQuestions.map(q => q.dimension))];
  
  return dimensions.map(dim => {
    const dimQuestions = scorableQuestions.filter(q => q.dimension === dim);
    let totalScore = 0, count = 0;
    
    responses.forEach(response => {
      const answers = typeof response.answers === 'string' ? JSON.parse(response.answers) : response.answers;
      dimQuestions.forEach(q => {
        const answerValue = answers[q.id];
        if (answerValue !== undefined && answerValue !== null) {
          const score = normalizeScore(answerValue, q.type, q.inverted);
          if (score !== null) {
            totalScore += score;
            count++;
          }
        }
      });
    });
    
    return { dimension: dim, score: count > 0 ? totalScore / count : 0 };
  });
}

function calculateIndividualDimensionScores(response, questions) {
  const answers = typeof response.answers === 'string' ? JSON.parse(response.answers) : response.answers;
  const scorableQuestions = questions.filter(q => SCORABLE_TYPES.includes(q.type));
  const dimensions = [...new Set(scorableQuestions.map(q => q.dimension))];
  const scores = {};
  
  dimensions.forEach(dim => {
    const dimQuestions = scorableQuestions.filter(q => q.dimension === dim);
    let total = 0, count = 0;
    
    dimQuestions.forEach(q => {
      const answerValue = answers[q.id];
      if (answerValue !== undefined && answerValue !== null) {
        const score = normalizeScore(answerValue, q.type, q.inverted);
        if (score !== null) {
          total += score;
          count++;
        }
      }
    });
    
    scores[dim] = count > 0 ? total / count : 0;
  });
  
  return scores;
}

function identifyRiskProfile(dimScores) {
  // Generic risk profile based on overall average across ALL dimensions
  const allScores = Object.values(dimScores);
  
  if (allScores.length === 0) return 'neutral';
  
  const avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  
  // Risk classification based on average score (adjusted thresholds)
  if (avgScore < 2.5) return 'critical';       // Crítico - precisa ação imediata
  if (avgScore < 3.0) return 'high_risk';      // Alto risco
  if (avgScore < 3.5) return 'moderate_risk';  // Risco moderado
  if (avgScore >= 4.2) return 'engaged';       // Engajado
  
  return 'neutral'; // 3.5 a 4.2 - zona neutra
}

function calculateRiskAlerts(responses, departments, questions) {
  const alerts = {
    total: { critical: 0, high_risk: 0, moderate_risk: 0, engaged: 0, neutral: 0 },
    byDepartment: {},
    byDimension: {}
  };
  
  // Get unique dimensions
  const scorableQuestions = questions.filter(q => SCORABLE_TYPES.includes(q.type));
  const dimensions = [...new Set(scorableQuestions.map(q => q.dimension))];
  
  // Initialize dimension alerts (same 5 categories as department)
  dimensions.forEach(dim => {
    alerts.byDimension[dim] = {
      name: dim, critical: 0, high_risk: 0, moderate_risk: 0, neutral: 0, engaged: 0, total: 0
    };
  });
  
  departments.forEach(dept => {
    alerts.byDepartment[dept.id] = {
      name: dept.name, critical: 0, high_risk: 0, moderate_risk: 0, engaged: 0, neutral: 0, total: 0
    };
  });
  
  responses.forEach(response => {
    const dimScores = calculateIndividualDimensionScores(response, questions);
    const profile = identifyRiskProfile(dimScores);
    
    alerts.total[profile]++;
    
    if (alerts.byDepartment[response.department_id]) {
      alerts.byDepartment[response.department_id][profile]++;
      alerts.byDepartment[response.department_id].total++;
    }
    
    // Calculate per-dimension risk for this response (same thresholds as identifyRiskProfile)
    Object.entries(dimScores).forEach(([dim, score]) => {
      if (alerts.byDimension[dim]) {
        alerts.byDimension[dim].total++;
        if (score < 2.5) {
          alerts.byDimension[dim].critical++;
        } else if (score < 3.0) {
          alerts.byDimension[dim].high_risk++;
        } else if (score < 3.5) {
          alerts.byDimension[dim].moderate_risk++;
        } else if (score < 4.2) {
          alerts.byDimension[dim].neutral++;
        } else {
          alerts.byDimension[dim].engaged++;
        }
      }
    });
  });
  
  alerts.departmentList = Object.values(alerts.byDepartment)
    .filter(dept => dept.total >= 1)
    .sort((a, b) => (b.critical + b.high_risk) - (a.critical + a.high_risk));
  
  // Dimension list sorted by worst to best (most critical first)
  alerts.dimensionList = Object.values(alerts.byDimension)
    .filter(dim => dim.total > 0)
    .sort((a, b) => (b.critical + b.high_risk) - (a.critical + a.high_risk));
  
  alerts.criticalDepartments = alerts.departmentList
    .filter(dept => {
      const atRisk = dept.critical + dept.high_risk + dept.moderate_risk;
      return dept.total > 0 && (atRisk / dept.total) > 0.5;
    })
    .map(dept => ({
      name: dept.name,
      percentAtRisk: Math.round(((dept.critical + dept.high_risk + dept.moderate_risk) / dept.total) * 100)
    }));
  
  return alerts;
}

// Calculate NPS from responses
function calculateNPS(responses, questions) {
  const npsQuestions = questions.filter(q => q.type === 'nps');
  if (npsQuestions.length === 0) return null;
  
  let promoters = 0, detractors = 0, neutrals = 0;
  
  responses.forEach(response => {
    const answers = typeof response.answers === 'string' ? JSON.parse(response.answers) : response.answers;
    
    npsQuestions.forEach(q => {
      const value = answers[q.id];
      if (value !== undefined && value !== null) {
        if (value >= 9) promoters++;
        else if (value <= 6) detractors++;
        else neutrals++;
      }
    });
  });
  
  const total = promoters + detractors + neutrals;
  if (total === 0) return null;
  
  return {
    score: Math.round(((promoters - detractors) / total) * 100),
    promoters: Math.round((promoters / total) * 100),
    neutrals: Math.round((neutrals / total) * 100),
    detractors: Math.round((detractors / total) * 100),
    totalResponses: total
  };
}

// Get demographic filters from questions (single_choice questions in first dimension)
function getDemographicFilters(questions, responses) {
  // Filter questions marked as demographic OR single_choice in demographic-looking dimensions
  const demographicQuestions = questions.filter(q => 
    q.is_demographic || 
    (q.type === 'single_choice' && q.options && Array.isArray(q.options))
  );
  
  return demographicQuestions.map(q => {
    // Count responses per option
    const optionCounts = {};
    const options = q.options || [];
    options.forEach(opt => { optionCounts[opt] = 0; });
    
    responses.forEach(response => {
      const answers = typeof response.answers === 'string' ? JSON.parse(response.answers) : response.answers;
      const value = answers[q.id];
      if (value && optionCounts[value] !== undefined) {
        optionCounts[value]++;
      }
    });
    
    // Only return filters that have at least some responses
    const hasResponses = Object.values(optionCounts).some(c => c > 0);
    
    return {
      questionId: q.id,
      label: q.text.replace(/[?:]/g, '').trim().substring(0, 50),
      fullLabel: q.text,
      dimension: q.dimension,
      isDemographic: q.is_demographic,
      options: options.map(opt => ({
        value: opt,
        label: opt,
        count: optionCounts[opt] || 0
      })).filter(opt => opt.count > 0), // Only show options with responses
      hasResponses
    };
  }).filter(f => f.hasResponses && f.options.length > 0); // Only return filters with data
}

// Apply demographic filters to responses
function applyDemographicFilters(responses, questions, filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return responses;
  }
  
  return responses.filter(response => {
    const answers = typeof response.answers === 'string' ? JSON.parse(response.answers) : response.answers;
    
    // Check all filters - response must match ALL filters
    for (const [questionId, expectedValue] of Object.entries(filters)) {
      const value = answers[questionId];
      if (value !== expectedValue) {
        return false;
      }
    }
    return true;
  });
}

// ==========================================
// ROUTES
// ==========================================

// Get pending diagnostics for user (enrolled but not responded)
router.get('/pending', authenticate, async (req, res) => {
  try {
    // Demo user sees ALL active diagnostics (can always respond)
    if (req.user.role === 'demo') {
      const allActive = await dbAll(`
        SELECT d.id, d.name, d.description,
          (SELECT COUNT(*) FROM questions q JOIN dimensions dim ON q.dimension_id = dim.id WHERE dim.diagnostic_id = d.id) as question_count
        FROM diagnostics d
        WHERE d.status = 'active'
        ORDER BY d.name
      `);
      return res.json(allActive);
    }

    // Regular users - only enrolled and not responded
    const pending = await dbAll(`
      SELECT d.id, d.name, d.description,
        (SELECT COUNT(*) FROM questions q JOIN dimensions dim ON q.dimension_id = dim.id WHERE dim.diagnostic_id = d.id) as question_count
      FROM diagnostics d
      JOIN user_diagnostics ud ON d.id = ud.diagnostic_id
      WHERE ud.user_id = $1
        AND d.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM responses r 
          WHERE r.user_id = $1 AND r.diagnostic_id = d.id
        )
      ORDER BY ud.enrolled_at
    `, [req.user.id]);
    
    res.json(pending);
  } catch (error) {
    console.error('Erro ao buscar diagnósticos pendentes:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Check if user has responded to a specific diagnostic
router.get('/check', authenticate, async (req, res) => {
  try {
    const { diagnostic_id } = req.query;
    
    // Demo user can always respond again
    if (req.user.role === 'demo') {
      return res.json({ hasResponded: false, diagnosticId: diagnostic_id || null });
    }
    
    // If specific diagnostic requested
    if (diagnostic_id) {
      const response = await dbGet(
        'SELECT id FROM responses WHERE user_id = $1 AND diagnostic_id = $2',
        [req.user.id, diagnostic_id]
      );
      return res.json({ hasResponded: !!response, diagnosticId: diagnostic_id });
    }
    
    // Otherwise, check all pending
    const pending = await dbAll(`
      SELECT d.id
      FROM diagnostics d
      JOIN user_diagnostics ud ON d.id = ud.diagnostic_id
      WHERE ud.user_id = $1
        AND d.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM responses r 
          WHERE r.user_id = $1 AND r.diagnostic_id = d.id
        )
    `, [req.user.id]);
    
    res.json({ 
      hasResponded: pending.length === 0, 
      pendingCount: pending.length,
      pendingIds: pending.map(p => p.id)
    });
  } catch (error) {
    console.error('Erro ao verificar resposta:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { department_id, diagnostic_id, answers, open_answers } = req.body;
    
    if (!department_id || !answers) {
      return res.status(400).json({ error: 'Departamento e respostas são obrigatórios' });
    }

    let diagId = diagnostic_id;
    if (!diagId) {
      const defaultDiag = await getDefaultDiagnostic();
      diagId = defaultDiag?.id;
    }

    const existing = await dbGet(
      'SELECT id FROM responses WHERE user_id = $1 AND diagnostic_id = $2',
      [req.user.id, diagId]
    );
    
    // Demo user: delete previous response before inserting new one
    if (req.user.role === 'demo' && existing) {
      await dbRun('DELETE FROM responses WHERE user_id = $1 AND diagnostic_id = $2', [req.user.id, diagId]);
    } else if (existing) {
      return res.status(400).json({ error: 'Você já respondeu a este diagnóstico' });
    }

    const department = await dbGet('SELECT id FROM departments WHERE id = $1', [department_id]);
    if (!department) {
      return res.status(400).json({ error: 'Departamento não encontrado' });
    }

    await dbRun(
      'INSERT INTO responses (user_id, department_id, diagnostic_id, answers, open_answers) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, department_id, diagId, JSON.stringify(answers), open_answers ? JSON.stringify(open_answers) : null]
    );

    res.status(201).json({ message: 'Resposta registrada com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar resposta:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.get('/', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { department_id, diagnostic_id } = req.query;
    
    let diagId = diagnostic_id;
    if (!diagId) {
      const defaultDiag = await getDefaultDiagnostic();
      diagId = defaultDiag?.id;
    }
    
    const questions = diagId ? await getQuestionsForDiagnostic(diagId) : [];
    
    let sql = `
      SELECT r.*, d.name as department_name 
      FROM responses r 
      LEFT JOIN departments d ON r.department_id = d.id
      WHERE r.diagnostic_id = $1
    `;
    const params = [diagId];
    
    if (department_id) {
      sql += ' AND r.department_id = $2';
      params.push(department_id);
    }
    sql += ' ORDER BY r.submitted_at DESC';

    const responses = await dbAll(sql, params);
    const responsesWithScore = responses.map((r, index) => ({
      id: r.id,
      index: index + 1,
      department_id: r.department_id,
      department_name: r.department_name,
      diagnostic_id: r.diagnostic_id,
      score: calculateScore(r.answers, questions),
      has_open_answers: !!r.open_answers && Object.keys(r.open_answers || {}).length > 0,
      submitted_at: r.submitted_at
    }));

    res.json(responsesWithScore);
  } catch (error) {
    console.error('Erro ao buscar respostas:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.get('/stats', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { department_id, diagnostic_id, demo_filters } = req.query;
    
    // Parse demographic filters from query string (JSON encoded)
    let demographicFilterValues = {};
    if (demo_filters) {
      try {
        demographicFilterValues = JSON.parse(demo_filters);
      } catch (e) {
        console.warn('Invalid demo_filters JSON:', demo_filters);
      }
    }
    
    let diagId = diagnostic_id;
    if (!diagId) {
      const defaultDiag = await getDefaultDiagnostic();
      diagId = defaultDiag?.id;
    }
    
    if (!diagId) {
      return res.json({ 
        totalResponses: 0, dimensionScores: [], overallScore: 0, departmentComparison: [], 
        participationRate: 0, heatmapData: [], rankingData: [],
        riskAlerts: { total: {}, byDepartment: {}, departmentList: [], criticalDepartments: [] }
      });
    }
    
    const questions = await getQuestionsForDiagnostic(diagId);
    const allResponses = await dbAll(`
      SELECT r.*, u.department_id as user_department_id 
      FROM responses r 
      LEFT JOIN users u ON r.user_id = u.id 
      WHERE r.diagnostic_id = $1
    `, [diagId]);
    
    // Use user's current department instead of response's saved department
    allResponses.forEach(r => {
      const userDept = r.user_department_id != null ? parseInt(r.user_department_id) : null;
      r.department_id = userDept || parseInt(r.department_id);
    });
    
    // Apply demographic filters first
    let demographicFilteredResponses = applyDemographicFilters(allResponses, questions, demographicFilterValues);
    
    // Then apply department filter
    let filteredResponses = demographicFilteredResponses;
    if (department_id) {
      filteredResponses = demographicFilteredResponses.filter(r => r.department_id === parseInt(department_id));
    }
    
    if (filteredResponses.length === 0 && (department_id || Object.keys(demographicFilterValues).length > 0)) {
      const dimensionScores = calculateDimensionScores(allResponses, questions);
      const overallScore = dimensionScores.length > 0 
        ? dimensionScores.reduce((a, b) => a + b.score, 0) / dimensionScores.length : 0;
      return res.json({ 
        totalResponses: 0, dimensionScores: [], overallScore: 0, departmentComparison: [], 
        participationRate: 0, heatmapData: [], rankingData: [],
        companyAverage: { dimensionScores, overallScore },
        riskAlerts: { total: {}, byDepartment: {}, departmentList: [], criticalDepartments: [] },
        demographicFilters: getDemographicFilters(questions, allResponses),
        appliedFilters: demographicFilterValues
      });
    }

    const dimensionScores = calculateDimensionScores(filteredResponses, questions);
    const overallScore = dimensionScores.length > 0 
      ? dimensionScores.reduce((a, b) => a + b.score, 0) / dimensionScores.length : 0;

    const departments = await dbAll(`
      SELECT d.id, d.name, COUNT(r.id) as response_count 
      FROM departments d 
      LEFT JOIN users u ON d.id = u.department_id
      LEFT JOIN responses r ON u.id = r.user_id AND r.diagnostic_id = $1
      WHERE d.diagnostic_id = $1 OR d.diagnostic_id IS NULL
      GROUP BY d.id HAVING COUNT(r.id) > 0 ORDER BY d.name
    `, [diagId]);
    
    // Use demographic-filtered responses for all calculations
    const departmentComparison = departments.map(dept => {
      const deptResponses = demographicFilteredResponses.filter(r => r.department_id === dept.id);
      const deptDimensionScores = calculateDimensionScores(deptResponses, questions);
      const deptScore = deptDimensionScores.length > 0 
        ? deptDimensionScores.reduce((a, b) => a + b.score, 0) / deptDimensionScores.length : 0;
      return { id: dept.id, name: dept.name, score: deptScore, responses: deptResponses.length };
    }).filter(d => d.responses > 0);

    const heatmapData = departments.map(dept => {
      const deptResponses = demographicFilteredResponses.filter(r => r.department_id === dept.id);
      const deptDimensionScores = calculateDimensionScores(deptResponses, questions);
      const dimensions = {};
      deptDimensionScores.forEach(d => { dimensions[d.dimension] = d.score; });
      const avgScore = deptDimensionScores.length > 0 
        ? deptDimensionScores.reduce((a, b) => a + b.score, 0) / deptDimensionScores.length : 0;
      return { id: dept.id, name: dept.name, dimensions, avgScore, responses: deptResponses.length };
    }).filter(d => d.responses > 0);

    const rankingData = [...departmentComparison].sort((a, b) => b.score - a.score);

    const companyDimensionScores = calculateDimensionScores(demographicFilteredResponses, questions);
    const companyOverallScore = companyDimensionScores.length > 0 
      ? companyDimensionScores.reduce((a, b) => a + b.score, 0) / companyDimensionScores.length : 0;

    const allDepartments = await dbAll('SELECT id, name FROM departments WHERE diagnostic_id = $1 OR diagnostic_id IS NULL', [diagId]);
    const riskAlerts = calculateRiskAlerts(demographicFilteredResponses, allDepartments, questions);

    // Calculate NPS if there are NPS questions
    const npsData = calculateNPS(filteredResponses, questions);

    // Get demographic filters with counts from ALL responses (not filtered)
    const demographicFilters = getDemographicFilters(questions, allResponses);

    // Count only users from this diagnostic
    const totalUsers = await dbGet(
      "SELECT COUNT(*) as count FROM users WHERE role = 'user' AND diagnostic_id = $1",
      [diagId]
    );
    const participationRate = parseInt(totalUsers.count) > 0 
      ? (filteredResponses.length / parseInt(totalUsers.count)) * 100 : 0;

    res.json({ 
      totalResponses: filteredResponses.length, dimensionScores, overallScore, departmentComparison, 
      participationRate, totalUsers: parseInt(totalUsers.count), respondedUsers: filteredResponses.length,
      heatmapData, rankingData,
      companyAverage: { dimensionScores: companyDimensionScores, overallScore: companyOverallScore },
      riskAlerts, diagnosticId: diagId,
      nps: npsData,
      demographicFilters,
      appliedFilters: demographicFilterValues
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.delete('/all', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem limpar as respostas' });
    }
    
    const { diagnostic_id } = req.query;
    
    if (diagnostic_id) {
      await dbRun('DELETE FROM responses WHERE diagnostic_id = $1', [diagnostic_id]);
    } else {
      await dbRun('DELETE FROM responses');
    }
    
    res.json({ message: 'Respostas excluídas com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir respostas:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// EXPORT CSV - Raw responses data
// ==========================================
router.get('/export/csv', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { diagnostic_id } = req.query;
    
    if (!diagnostic_id) {
      return res.status(400).json({ error: 'diagnostic_id é obrigatório' });
    }

    // Get diagnostic info
    const diagnostic = await dbGet('SELECT * FROM diagnostics WHERE id = $1', [diagnostic_id]);
    if (!diagnostic) {
      return res.status(404).json({ error: 'Diagnóstico não encontrado' });
    }

    // Get all questions for this diagnostic (ordered)
    const questions = await dbAll(`
      SELECT q.id, q.text, q.type, q.is_demographic,
             d.name as dimension_name
      FROM questions q
      JOIN dimensions d ON q.dimension_id = d.id
      WHERE d.diagnostic_id = $1
      ORDER BY d.sort_order, q.sort_order
    `, [diagnostic_id]);

    if (questions.length === 0) {
      return res.status(400).json({ error: 'Diagnóstico não possui perguntas' });
    }

    // Get all responses with department info
    const responses = await dbAll(`
      SELECT r.id, r.answers, r.open_answers, r.submitted_at,
             dep.name as department_name
      FROM responses r
      LEFT JOIN departments dep ON r.department_id = dep.id
      WHERE r.diagnostic_id = $1
      ORDER BY r.submitted_at DESC
    `, [diagnostic_id]);

    if (responses.length === 0) {
      return res.status(400).json({ error: 'Nenhuma resposta encontrada para este diagnóstico' });
    }

    // Build CSV
    // Header row: Data, Departamento, Q1, Q2, Q3...
    const headers = ['Data', 'Departamento'];
    questions.forEach((q, idx) => {
      // Use shorter header: dimension - question number
      headers.push(`${q.dimension_name} - P${idx + 1}`);
    });

    // Escape CSV value
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // Build rows
    const rows = [headers.map(escapeCSV).join(',')];
    
    for (const response of responses) {
      const row = [];
      
      // Date formatted as DD/MM/YYYY HH:MM
      const date = new Date(response.submitted_at);
      const dateStr = date.toLocaleString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      row.push(escapeCSV(dateStr));
      
      // Department
      row.push(escapeCSV(response.department_name || 'Não informado'));
      
      // Parse answers
      let answers = {};
      try {
        answers = typeof response.answers === 'string' 
          ? JSON.parse(response.answers) 
          : (response.answers || {});
      } catch (e) {
        answers = {};
      }

      // Parse open answers
      let openAnswers = {};
      try {
        openAnswers = typeof response.open_answers === 'string'
          ? JSON.parse(response.open_answers)
          : (response.open_answers || {});
      } catch (e) {
        openAnswers = {};
      }
      
      // Add answer for each question
      for (const q of questions) {
        let value = answers[q.id];
        
        // For open questions, check open_answers
        if (q.type === 'open') {
          value = openAnswers[q.id] || '';
        }
        
        // For multiple choice, join with semicolon
        if (Array.isArray(value)) {
          value = value.join('; ');
        }
        
        row.push(escapeCSV(value));
      }
      
      rows.push(row.join(','));
    }

    const csv = rows.join('\n');
    
    // Generate filename
    const safeName = diagnostic.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${safeName}_respostas_${dateStr}.csv`;

    // Send CSV with BOM for Excel compatibility
    const BOM = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(BOM + csv);

  } catch (error) {
    console.error('Erro ao exportar CSV:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

export default router;
