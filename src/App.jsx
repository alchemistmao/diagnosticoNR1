import React, { useState, useEffect, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { authApi, usersApi, departmentsApi, responsesApi, diagnosticsApi, getStoredUser, clearAuth } from './api';

// ==========================================
// CONTEXT
// ==========================================

const AuthContext = createContext(null);

const useAuth = () => useContext(AuthContext);

// ==========================================
// OPEN QUESTIONS (these remain static)
// ==========================================

const openQuestions = [
  { id: 'open1', text: "Na sua opinião, o que a empresa poderia fazer para melhorar o ambiente de trabalho?" },
  { id: 'open2', text: "Há algo mais que gostaria de compartilhar sobre sua experiência na empresa?" },
];

// ==========================================
// UTILS
// ==========================================

const getRiskLevel = (score) => {
  if (score >= 4) return { level: 'Baixo', color: '#00E8C8', bg: '#d1fae5' };
  if (score >= 3) return { level: 'Moderado', color: '#f59e0b', bg: '#fef3c7' };
  return { level: 'Alto', color: '#ef4444', bg: '#fee2e2' };
};

// ==========================================
// COMPONENTS
// ==========================================

// Logo Component
const Logo = ({ size = 'medium' }) => {
  const sizes = { small: 48, medium: 120, large: 180 };
  return (
    <img 
      src="/logo.png" 
      alt="Cuidar+" 
      style={{ width: sizes[size], height: sizes[size], objectFit: 'contain' }}
    />
  );
};

// Loading Spinner
const Loading = () => (
  <div className="loading-container">
    <div className="loading-spinner"></div>
    <p>Carregando...</p>
  </div>
);

// Toast Notification
const Toast = ({ message, type, onClose }) => (
  <motion.div
    className={`toast toast-${type}`}
    initial={{ opacity: 0, y: 50 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 50 }}
  >
    <span>{type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <p>{message}</p>
    <button onClick={onClose}>×</button>
  </motion.div>
);

// ==========================================
// LOGIN SCREEN
// ==========================================

const LoginScreen = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await authApi.login(email, password);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-decoration">
        <div className="arc arc-1"></div>
        <div className="arc arc-2"></div>
      </div>
      
      <motion.div 
        className="login-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="login-logo">
          <Logo size="large" />
        </div>
        
        <h1 className="login-title">Diagnóstico Cuidar+</h1>
        <p className="login-slogan">Performance com bem-estar</p>
        
        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          
          <div className="form-group">
            <label>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              disabled={loading}
            />
          </div>
          
          <div className="form-group">
            <label>Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
            />
          </div>
          
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        
        <p className="login-footer">
          Plataforma em conformidade com a NR-1
        </p>
      </motion.div>
    </div>
  );
};

// ==========================================
// USER SURVEY FLOW
// ==========================================

const UserSurvey = ({ user, onComplete }) => {
  const [step, setStep] = useState('loading');
  const [pendingDiagnostics, setPendingDiagnostics] = useState([]);
  const [selectedDiagnostic, setSelectedDiagnostic] = useState(null);
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState({});
  const [openAnswers, setOpenAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      // Get pending diagnostics (enrolled but not responded)
      const pending = await responsesApi.getPending();
      setPendingDiagnostics(pending);
      
      if (pending.length === 0) {
        // All done!
        setStep('already-responded');
        setLoading(false);
        return;
      }
      
      if (pending.length === 1) {
        // Only one pending, go directly
        await selectDiagnostic(pending[0]);
      } else {
        // Multiple pending, show selection
        setStep('select-diagnostic');
        setLoading(false);
      }
    } catch (err) {
      // Only show error if it's not a redirect situation
      if (err.message) {
        setError(err.message);
      }
      setLoading(false);
    }
  };

  const selectDiagnostic = async (diagnostic) => {
    try {
      setLoading(true);
      setSelectedDiagnostic(diagnostic);
      
      // Load questions and departments for this diagnostic
      const { questions: diagQuestions, departments: diagDepts } = await diagnosticsApi.getQuestions(diagnostic.id);
      setQuestions(diagQuestions);
      setDepartments(diagDepts || []);
      
      // Reset department selection
      setDepartmentId('');
      
      setStep('welcome');
    } catch (err) {
      if (err.message) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = (questionId, value) => {
    setAnswers({ ...answers, [questionId]: value });
  };

  const handleOpenAnswer = (questionId, value) => {
    setOpenAnswers({ ...openAnswers, [questionId]: value });
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      // Skip open-questions step if there are no hardcoded open questions
      // Note: open-type questions from DB are now part of the main questions array
      if (openQuestions.length > 0) {
        setStep('open-questions');
      } else {
        handleSubmit();
      }
    }
  };

  const handlePrev = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      await responsesApi.submit({
        department_id: parseInt(departmentId),
        diagnostic_id: selectedDiagnostic?.id,
        answers,
        open_answers: openAnswers
      });
      
      // Update remaining diagnostics
      const remaining = pendingDiagnostics.filter(d => d.id !== selectedDiagnostic.id);
      setPendingDiagnostics(remaining);
      
      // Always go to thank-you screen first
      setStep('thank-you');
      
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinue = async () => {
    // Reset for next diagnostic
    setAnswers({});
    setOpenAnswers({});
    setCurrentQuestion(0);
    
    if (pendingDiagnostics.length === 1) {
      await selectDiagnostic(pendingDiagnostics[0]);
    } else {
      setStep('select-diagnostic');
    }
  };

  const handleLogout = () => {
    clearAuth();
    window.location.reload();
  };

  if (loading) return <Loading />;

  // Error screen
  if (error && step === 'loading') {
    return (
      <div className="survey-container">
        <motion.div 
          className="survey-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Logo size="medium" />
          <div className="error-icon">⚠️</div>
          <h2>Ops, algo deu errado</h2>
          <p className="error-message">{error}</p>
          <div className="btn-group" style={{ marginTop: '20px' }}>
            <button 
              className="btn-secondary" 
              onClick={() => {
                clearAuth();
                window.location.reload();
              }}
            >
              Voltar ao login
            </button>
            <button 
              className="btn-primary" 
              onClick={() => {
                setError('');
                setStep('loading');
                setLoading(true);
                loadInitialData();
              }}
            >
              Tentar novamente
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Select diagnostic screen (multiple pending)
  if (step === 'select-diagnostic') {
    return (
      <div className="survey-container">
        <motion.div 
          className="survey-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Logo size="medium" />
          <h2>Olá, {user.name.split(' ')[0]}!</h2>
          <p>Você tem <strong>{pendingDiagnostics.length} diagnósticos</strong> pendentes.</p>
          <p className="survey-note">Selecione qual deseja responder agora:</p>
          
          <div className="diagnostic-selection">
            {pendingDiagnostics.map(diag => (
              <button
                key={diag.id}
                className="diagnostic-option"
                onClick={() => selectDiagnostic(diag)}
              >
                <div className="diagnostic-option-name">{diag.name}</div>
                <div className="diagnostic-option-meta">
                  {diag.question_count} perguntas
                </div>
                {diag.description && (
                  <div className="diagnostic-option-desc">{diag.description}</div>
                )}
              </button>
            ))}
          </div>

          <button 
            className="btn-secondary" 
            onClick={() => {
              clearAuth();
              window.location.reload();
            }}
            style={{ marginTop: '20px' }}
          >
            Sair / Trocar usuário
          </button>
        </motion.div>
      </div>
    );
  }

  // Already responded to all
  if (step === 'already-responded') {
    return (
      <div className="survey-container">
        <motion.div 
          className="survey-card thank-you-card"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Logo size="medium" />
          <div className="thank-you-icon">✓</div>
          <h2>Tudo certo!</h2>
          <p>Você já respondeu todos os diagnósticos disponíveis.</p>
          <p className="login-slogan">Obrigado por contribuir!</p>
          <button 
            className="btn-secondary" 
            onClick={() => {
              clearAuth();
              window.location.reload();
            }}
            style={{ marginTop: '20px' }}
          >
            Sair / Trocar usuário
          </button>
        </motion.div>
      </div>
    );
  }

  // Welcome screen
  if (step === 'welcome') {
    return (
      <div className="survey-container">
        <motion.div 
          className="survey-card welcome-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Logo size="medium" />
          <h2>Bem-vindo(a), {user.name.split(' ')[0]}!</h2>
          <p>Você está prestes a participar do <strong>{selectedDiagnostic?.name || 'Diagnóstico'}</strong>.</p>
          
          <div className="info-cards">
            <div className="info-card">
              <span className="info-icon">🔒</span>
              <span>100% anônimo</span>
            </div>
            <div className="info-card">
              <span className="info-icon">⏱️</span>
              <span>10-15 minutos</span>
            </div>
            <div className="info-card">
              <span className="info-icon">📊</span>
              <span>{questions.length + 2} perguntas</span>
            </div>
          </div>

          <p className="survey-note">
            Suas respostas são confidenciais e serão utilizadas apenas para análises agregadas, 
            sem identificação individual.
          </p>

          <button className="btn-primary" onClick={() => setStep('department')}>
            Começar
          </button>
        </motion.div>
      </div>
    );
  }

  // Department selection
  if (step === 'department') {
    return (
      <div className="survey-container">
        <motion.div 
          className="survey-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2>Selecione seu departamento</h2>
          <p>Essa informação é usada apenas para análises por área.</p>

          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              required
            >
              <option value="">Selecione...</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>

          <div className="btn-group">
            <button className="btn-secondary" onClick={() => setStep('welcome')}>
              Voltar
            </button>
            <button 
              className="btn-primary" 
              onClick={() => setStep('questions')}
              disabled={!departmentId}
            >
              Continuar
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Questions
  // Helper to render question based on type
  const renderQuestionInput = (question) => {
    const type = question.type || 'likert5';
    const currentValue = answers[question.id];

    switch (type) {
      case 'likert5':
        return (
          <div className="likert-scale">
            {[1, 2, 3, 4, 5].map(value => (
              <button
                key={value}
                className={`likert-option ${currentValue === value ? 'selected' : ''}`}
                onClick={() => handleAnswer(question.id, value)}
              >
                <span className="likert-emoji">
                  {value === 1 ? '😡' : value === 2 ? '😟' : value === 3 ? '😐' : value === 4 ? '🙂' : '😍'}
                </span>
                <span className="likert-number">{value}</span>
                <span className="likert-label">
                  {value === 1 ? 'Discordo totalmente' : 
                   value === 2 ? 'Discordo' : 
                   value === 3 ? 'Neutro' : 
                   value === 4 ? 'Concordo' : 
                   'Concordo totalmente'}
                </span>
              </button>
            ))}
          </div>
        );

      case 'likert10':
      case 'nps':
        return (
          <div className="nps-scale">
            <div className="nps-labels">
              <span>Nada provável</span>
              <span>Muito provável</span>
            </div>
            <div className="nps-buttons">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(value => (
                <button
                  key={value}
                  className={`nps-option ${currentValue === value ? 'selected' : ''} ${value <= 6 ? 'detractor' : value <= 8 ? 'neutral' : 'promoter'}`}
                  onClick={() => handleAnswer(question.id, value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        );

      case 'yes_no':
        return (
          <div className="yesno-scale">
            <button
              className={`yesno-option ${currentValue === 1 ? 'selected' : ''}`}
              onClick={() => handleAnswer(question.id, 1)}
            >
              ✓ Sim
            </button>
            <button
              className={`yesno-option ${currentValue === 0 ? 'selected' : ''}`}
              onClick={() => handleAnswer(question.id, 0)}
            >
              ✕ Não
            </button>
          </div>
        );

      case 'single_choice':
        const options = question.options || [];
        return (
          <div className="choice-list">
            {options.map((option, idx) => (
              <button
                key={idx}
                className={`choice-option ${currentValue === option ? 'selected' : ''}`}
                onClick={() => handleAnswer(question.id, option)}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'multiple_choice':
        const multiOptions = question.options || [];
        const multiValue = Array.isArray(currentValue) ? currentValue : [];
        return (
          <div className="choice-list multiple">
            {multiOptions.map((option, idx) => (
              <button
                key={idx}
                className={`choice-option ${multiValue.includes(option) ? 'selected' : ''}`}
                onClick={() => {
                  const newValue = multiValue.includes(option)
                    ? multiValue.filter(v => v !== option)
                    : [...multiValue, option];
                  handleAnswer(question.id, newValue);
                }}
              >
                <span className="checkbox">{multiValue.includes(option) ? '☑' : '☐'}</span>
                {option}
              </button>
            ))}
          </div>
        );

      case 'open':
        return (
          <div className="open-input">
            <textarea
              value={currentValue || ''}
              onChange={(e) => handleAnswer(question.id, e.target.value)}
              rows={4}
              placeholder="Digite sua resposta..."
            />
          </div>
        );

      default:
        return <p>Tipo de pergunta não suportado: {type}</p>;
    }
  };

  // Check if current question is answered (for enabling next button)
  const isQuestionAnswered = (question) => {
    const value = answers[question.id];
    const type = question.type || 'likert5';
    
    if (!question.required) return true;
    
    // Open questions are always considered answered (blank is OK)
    if (type === 'open') return true;
    
    if (value === undefined || value === null) return false;
    if (type === 'multiple_choice' && Array.isArray(value) && value.length === 0) return false;
    
    return true;
  };

  if (step === 'questions') {
    const question = questions[currentQuestion];
    const progress = ((currentQuestion + 1) / questions.length) * 100;

    return (
      <div className="survey-container">
        <motion.div 
          className="survey-card question-card"
          key={currentQuestion}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          <p className="progress-text">Pergunta {currentQuestion + 1} de {questions.length}</p>
          
          <div className="question-dimension">{question.dimension_name}</div>
          <h3 className="question-text">{question.text}</h3>

          {renderQuestionInput(question)}

          <div className="btn-group">
            <button 
              className="btn-secondary" 
              onClick={handlePrev}
              disabled={currentQuestion === 0}
            >
              Anterior
            </button>
            <button 
              className="btn-primary" 
              onClick={handleNext}
              disabled={!isQuestionAnswered(question)}
            >
              {currentQuestion === questions.length - 1 ? 'Continuar' : 'Próxima'}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Open questions
  if (step === 'open-questions') {
    return (
      <div className="survey-container">
        <motion.div 
          className="survey-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2>Perguntas abertas</h2>
          <p className="survey-note">Opcional - sinta-se à vontade para compartilhar</p>

          {error && <div className="form-error">{error}</div>}

          {openQuestions.map(q => (
            <div key={q.id} className="form-group">
              <label>{q.text}</label>
              <textarea
                value={openAnswers[q.id] || ''}
                onChange={(e) => handleOpenAnswer(q.id, e.target.value)}
                rows={4}
                placeholder="Escreva aqui... (opcional)"
              />
            </div>
          ))}

          <div className="btn-group">
            <button 
              className="btn-secondary" 
              onClick={() => {
                setStep('questions');
                setCurrentQuestion(questions.length - 1);
              }}
            >
              Voltar
            </button>
            <button 
              className="btn-primary" 
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Enviando...' : 'Enviar respostas'}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Thank you
  if (step === 'thank-you') {
    return (
      <div className="survey-container">
        <motion.div 
          className="survey-card thank-you-card"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Logo size="medium" />
          <div className="thank-you-icon">🎉</div>
          <h2>Obrigado!</h2>
          <p>Sua participação é fundamental para construirmos um ambiente de trabalho mais saudável.</p>
          <p className="login-slogan">Performance com bem-estar</p>
          
          <div className="thank-you-buttons">
            {pendingDiagnostics.length > 0 && (
              <button className="btn-primary" onClick={handleContinue}>
                Continuar ({pendingDiagnostics.length} {pendingDiagnostics.length === 1 ? 'pendente' : 'pendentes'})
              </button>
            )}
            <button className="btn-secondary" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return null;
};

// ==========================================
// ADMIN/RH DASHBOARD
// ==========================================

const Dashboard = ({ departmentFilter, setDepartmentFilter, departments, diagnostics, diagnosticFilter, setDiagnosticFilter }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [demoFilters, setDemoFilters] = useState({});
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadStats();
  }, [departmentFilter, diagnosticFilter, demoFilters]);

  // Reset demo filters when diagnostic changes
  useEffect(() => {
    setDemoFilters({});
  }, [diagnosticFilter]);

  const loadStats = async () => {
    if (!diagnosticFilter) {
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await responsesApi.getStats(departmentFilter || null, diagnosticFilter, demoFilters);
      setStats(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    if (!diagnosticFilter) return;
    setExporting(true);
    try {
      await responsesApi.exportCSV(diagnosticFilter);
    } catch (err) {
      alert('Erro ao exportar: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleDemoFilterChange = (questionId, value) => {
    setDemoFilters(prev => {
      const newFilters = { ...prev };
      if (value === '') {
        delete newFilters[questionId];
      } else {
        newFilters[questionId] = value;
      }
      return newFilters;
    });
  };

  const clearAllFilters = () => {
    setDemoFilters({});
    setDepartmentFilter('');
  };

  const hasActiveFilters = Object.keys(demoFilters).length > 0 || departmentFilter;

  if (loading) return <Loading />;
  if (error) return <div className="error-message">{error}</div>;

  const overallRisk = stats ? getRiskLevel(stats.overallScore) : null;
  const selectedDept = departmentFilter ? departments.find(d => d.id == departmentFilter) : null;
  const selectedDiag = diagnosticFilter ? diagnostics.find(d => d.id == diagnosticFilter) : null;

  // No diagnostic selected
  if (!diagnosticFilter) {
    return (
      <div className="dashboard">
        <div className="dashboard-header">
          <div>
            <h1>Dashboard de Resultados</h1>
            <p>Selecione um diagnóstico para visualizar os resultados</p>
          </div>
        </div>
        <div className="diagnostic-selector-card">
          <h3>📊 Selecione o Diagnóstico</h3>
          <p>Escolha qual diagnóstico deseja analisar:</p>
          <div className="diagnostic-buttons">
            {diagnostics.filter(d => d.status === 'active' || d.response_count > 0).map(diag => (
              <button
                key={diag.id}
                className="diagnostic-select-btn"
                onClick={() => setDiagnosticFilter(diag.id)}
              >
                <span className="diag-name">{diag.name}</span>
                <span className="diag-meta">{diag.response_count || 0} respostas</span>
              </button>
            ))}
          </div>
          {diagnostics.length === 0 && (
            <p className="empty-message">Nenhum diagnóstico cadastrado</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>
            {selectedDept 
              ? `${selectedDiag?.name}: ${selectedDept.name}` 
              : selectedDiag?.name || 'Dashboard de Resultados'}
          </h1>
          <p>
            {selectedDept 
              ? `Análise do departamento de ${selectedDept.name}` 
              : `Análise consolidada - ${selectedDiag?.name || 'Diagnóstico'}`}
          </p>
        </div>
        <div className="dashboard-filters">
          <select 
            className="filter-select"
            value={diagnosticFilter}
            onChange={(e) => setDiagnosticFilter(e.target.value)}
          >
            <option value="">Trocar diagnóstico...</option>
            {diagnostics.filter(d => d.status === 'active' || d.response_count > 0).map(diag => (
              <option key={diag.id} value={diag.id}>{diag.name} ({diag.response_count || 0})</option>
            ))}
          </select>
          <select 
            className="filter-select"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="">Todos os departamentos</option>
            {departments.map(dept => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
          
          {/* Demographic Filters */}
          {stats?.demographicFilters?.map(filter => (
            <select
              key={filter.questionId}
              className="filter-select demographic-filter"
              value={demoFilters[filter.questionId] || ''}
              onChange={(e) => handleDemoFilterChange(filter.questionId, e.target.value)}
              title={filter.fullLabel}
            >
              <option value="">{filter.label}</option>
              {filter.options.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.count})
                </option>
              ))}
            </select>
          ))}
          
          {hasActiveFilters && (
            <button 
              className="btn-clear-filters"
              onClick={clearAllFilters}
              title="Limpar todos os filtros"
            >
              ✕ Limpar
            </button>
          )}
          
          {diagnosticFilter && stats?.totalResponses > 0 && (
            <button 
              className="btn-export"
              onClick={handleExportCSV}
              disabled={exporting}
              title="Exportar dados brutos em CSV"
            >
              {exporting ? '⏳ Exportando...' : '📥 Exportar CSV'}
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon">📝</div>
          <div>
            <div className="kpi-value">{stats?.totalResponses || 0}</div>
            <div className="kpi-label">Respostas</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon">👥</div>
          <div>
            <div className="kpi-value">{stats?.participationRate?.toFixed(0) || 0}%</div>
            <div className="kpi-label">Participação</div>
          </div>
        </div>
        <div className="kpi-card highlight">
          <div>
            <div className="kpi-value" style={{ color: overallRisk?.color }}>
              {stats?.overallScore?.toFixed(1) || '-'}
            </div>
            <div className="kpi-label">Índice Geral</div>
            {stats?.overallScore > 0 && (
              <span className="kpi-badge" style={{ backgroundColor: overallRisk?.bg, color: overallRisk?.color }}>
                Risco {overallRisk?.level}
              </span>
            )}
          </div>
        </div>
        {stats?.nps ? (
          <div className="kpi-card">
            <div className="kpi-icon">📊</div>
            <div>
              <div className="kpi-value" style={{ 
                color: stats.nps.score >= 75 ? '#22c55e' : stats.nps.score >= 50 ? '#84cc16' : stats.nps.score > 0 ? '#f59e0b' : '#ef4444' 
              }}>
                {stats.nps.score}
              </div>
              <div className="kpi-label">eNPS Score</div>
              <span className="kpi-badge" style={{ 
                backgroundColor: stats.nps.score >= 75 ? '#dcfce7' : stats.nps.score >= 50 ? '#d9f99d' : stats.nps.score > 0 ? '#fef3c7' : '#fee2e2',
                color: stats.nps.score >= 75 ? '#166534' : stats.nps.score >= 50 ? '#3f6212' : stats.nps.score > 0 ? '#92400e' : '#991b1b'
              }}>
                {stats.nps.score >= 75 ? 'Excelência' : stats.nps.score >= 50 ? 'Qualidade' : stats.nps.score > 0 ? 'Aperfeiçoamento' : 'Crítico'}
              </span>
            </div>
          </div>
        ) : (
          <div className="kpi-card">
            <div className="kpi-icon">🏢</div>
            <div>
              <div className="kpi-value">{departments.length}</div>
              <div className="kpi-label">Departamentos</div>
            </div>
          </div>
        )}
      </div>

      {/* Legenda de Risco - Compacta no topo */}
      <div className="legend-inline">
        <span className="legend-title">Legenda:</span>
        <div className="legend-inline-item">
          <span className="legend-dot" style={{ backgroundColor: '#00E8C8' }}></span>
          <span>Baixo (≥4.0)</span>
        </div>
        <div className="legend-inline-item">
          <span className="legend-dot" style={{ backgroundColor: '#f59e0b' }}></span>
          <span>Moderado (3.0-3.9)</span>
        </div>
        <div className="legend-inline-item">
          <span className="legend-dot" style={{ backgroundColor: '#ef4444' }}></span>
          <span>Alto (&lt;3.0)</span>
        </div>
      </div>

      {stats?.totalResponses > 0 || stats?.heatmapData?.length > 0 ? (
        <>
          {/* Charts */}
          <div className="charts-grid">
            <div className="chart-card">
              <h3>
                {selectedDept 
                  ? `Mapa de Risco: ${selectedDept.name}` 
                  : 'Mapa de Risco Psicossocial'}
              </h3>
              {stats.dimensionScores?.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={stats.dimensionScores}>
                    <PolarGrid stroke="#E6E9EA" />
                    <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: '#252F1F' }} />
                    <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 10, fill: '#64748b' }} />
                    <Radar 
                      dataKey="score" 
                      stroke={overallRisk?.color || '#00E8C8'} 
                      fill={overallRisk?.color || '#00E8C8'} 
                      fillOpacity={0.3} 
                      strokeWidth={2} 
                    />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-chart">Selecione "Todos os departamentos" para ver o mapa geral</div>
              )}
            </div>

            {/* Condicional: Se filtrado, mostra comparação com média. Se não, mostra bar chart */}
            <div className="chart-card">
              {departmentFilter ? (
                <>
                  <h3>{selectedDept?.name} vs Média da Empresa</h3>
                  {stats.dimensionScores?.length > 0 && stats.companyAverage?.dimensionScores?.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <RadarChart data={stats.companyAverage.dimensionScores.map((dim, i) => ({
                        dimension: dim.dimension.split(' ')[0],
                        empresa: parseFloat(dim.score.toFixed(2)),
                        departamento: parseFloat((stats.dimensionScores[i]?.score || 0).toFixed(2))
                      }))}>
                        <PolarGrid stroke="#E6E9EA" />
                        <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: '#252F1F' }} />
                        <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 10, fill: '#64748b' }} />
                        <Radar name="Média Empresa" dataKey="empresa" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.2} strokeWidth={2} />
                        <Radar name={selectedDept?.name || 'Departamento'} dataKey="departamento" stroke={overallRisk?.color || '#00E8C8'} fill={overallRisk?.color || '#00E8C8'} fillOpacity={0.3} strokeWidth={2} />
                        <Tooltip formatter={(value) => value.toFixed(2)} />
                      </RadarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-chart">Sem dados para comparação</div>
                  )}
                </>
              ) : (
                <>
                  <h3>Comparativo por Departamento</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={stats.departmentComparison} margin={{ bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E6E9EA" />
                      <XAxis 
                        dataKey="name" 
                        tick={{ fontSize: 11, fill: '#252F1F' }} 
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                        height={70}
                      />
                      <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: '#252F1F' }} />
                      <Tooltip 
                        formatter={(value) => [value.toFixed(2), 'Score']}
                        labelStyle={{ fontWeight: 600 }}
                      />
                      <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                        {stats.departmentComparison.map((entry, index) => (
                          <Cell key={index} fill={getRiskLevel(entry.score).color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
          </div>

          {/* ALERTAS DE RISCO */}
          {stats.riskAlerts && (
            <div className="risk-alerts-section">
              <h3>
                {selectedDept 
                  ? `🚨 Alertas de Risco: ${selectedDept.name}` 
                  : '🚨 Alertas de Risco (Anônimo)'}
              </h3>
              
              {/* Cards de Alerta - Dados do departamento filtrado ou total */}
              {(() => {
                const deptData = departmentFilter && stats.riskAlerts.byDepartment
                  ? stats.riskAlerts.byDepartment[departmentFilter]
                  : null;
                const alertData = deptData || stats.riskAlerts.total;
                const hasSufficientData = !deptData || (deptData && deptData.total >= 3);
                
                if (!hasSufficientData) {
                  return (
                    <div className="insufficient-data">
                      🔒 Dados insuficientes para exibir alertas (mínimo 3 respostas para preservar anonimato)
                    </div>
                  );
                }
                
                const totalAtRisk = (alertData.critical || 0) + (alertData.high_risk || 0) + (alertData.moderate_risk || 0);
                const totalAll = (alertData.critical || 0) + (alertData.high_risk || 0) + (alertData.moderate_risk || 0) + (alertData.engaged || 0) + (alertData.neutral || 0);
                const percentAtRisk = totalAll > 0 ? Math.round((totalAtRisk / totalAll) * 100) : 0;
                
                return (
                  <>
                    <div className="risk-cards">
                      <div className="risk-card critical">
                        <div className="risk-card-icon">🔴</div>
                        <div className="risk-card-content">
                          <div className="risk-card-value">{alertData.critical || 0}</div>
                          <div className="risk-card-label">Crítico</div>
                        </div>
                      </div>
                      <div className="risk-card high-risk">
                        <div className="risk-card-icon">🟠</div>
                        <div className="risk-card-content">
                          <div className="risk-card-value">{alertData.high_risk || 0}</div>
                          <div className="risk-card-label">Alto Risco</div>
                        </div>
                      </div>
                      <div className="risk-card moderate-risk">
                        <div className="risk-card-icon">🟡</div>
                        <div className="risk-card-content">
                          <div className="risk-card-value">{alertData.moderate_risk || 0}</div>
                          <div className="risk-card-label">Risco Moderado</div>
                        </div>
                      </div>
                      <div className="risk-card neutral">
                        <div className="risk-card-icon">🔵</div>
                        <div className="risk-card-content">
                          <div className="risk-card-value">{alertData.neutral || 0}</div>
                          <div className="risk-card-label">Neutros</div>
                        </div>
                      </div>
                      <div className="risk-card engaged">
                        <div className="risk-card-icon">🟢</div>
                        <div className="risk-card-content">
                          <div className="risk-card-value">{alertData.engaged || 0}</div>
                          <div className="risk-card-label">Engajados</div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Alerta crítico para departamento filtrado */}
                    {deptData && percentAtRisk > 50 && (
                      <div className="critical-alerts">
                        <div className="critical-alert">
                          ⚠️ <strong>{percentAtRisk}%</strong> dos colaboradores deste departamento estão em algum nível de risco
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Alertas Críticos Gerais (apenas visão geral) */}
              {!departmentFilter && stats.riskAlerts.criticalDepartments?.length > 0 && (
                <div className="critical-alerts">
                  {stats.riskAlerts.criticalDepartments.map(dept => (
                    <div key={dept.name} className="critical-alert">
                      ⚠️ <strong>{dept.name}</strong> tem {dept.percentAtRisk}% dos colaboradores em algum nível de risco
                    </div>
                  ))}
                </div>
              )}

              {/* Tabela de Risco por Departamento (apenas visão geral) */}
              {!departmentFilter && stats.riskAlerts.departmentList?.length > 0 && (
                <div className="risk-table-container">
                  <h4>Riscos por Departamento</h4>
                  <table className="risk-table">
                    <thead>
                      <tr>
                        <th>Departamento</th>
                        <th>🔴</th>
                        <th>🟠</th>
                        <th>🟡</th>
                        <th>🔵</th>
                        <th>🟢</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.riskAlerts.departmentList.map(dept => (
                        <tr key={dept.name}>
                          <td className="risk-dept-name">{dept.name}</td>
                          <td className={(dept.critical || 0) > 0 ? 'risk-critical' : ''}>{dept.critical || 0}</td>
                          <td className={(dept.high_risk || 0) > 0 ? 'risk-high' : ''}>{dept.high_risk || 0}</td>
                          <td className={(dept.moderate_risk || 0) > 0 ? 'risk-moderate' : ''}>{dept.moderate_risk || 0}</td>
                          <td className={(dept.neutral || 0) > 0 ? 'risk-neutral' : ''}>{dept.neutral || 0}</td>
                          <td className={(dept.engaged || 0) > 0 ? 'risk-good' : ''}>{dept.engaged || 0}</td>
                          <td><strong>{dept.total}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tabela de Risco por Dimensão */}
              {stats.riskAlerts.dimensionList?.length > 0 && (
                <div className="risk-table-container">
                  <h4>Distribuição de Avaliações por Dimensão</h4>
                  <table className="risk-table">
                    <thead>
                      <tr>
                        <th>Dimensão</th>
                        <th>🔴</th>
                        <th>🟠</th>
                        <th>🟡</th>
                        <th>🔵</th>
                        <th>🟢</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.riskAlerts.dimensionList.map(dim => (
                        <tr key={dim.name}>
                          <td className="risk-dim-name">{dim.name}</td>
                          <td className={(dim.critical || 0) > 0 ? 'risk-critical' : ''}>{dim.critical || 0}</td>
                          <td className={(dim.high_risk || 0) > 0 ? 'risk-high' : ''}>{dim.high_risk || 0}</td>
                          <td className={(dim.moderate_risk || 0) > 0 ? 'risk-moderate' : ''}>{dim.moderate_risk || 0}</td>
                          <td className={(dim.neutral || 0) > 0 ? 'risk-neutral' : ''}>{dim.neutral || 0}</td>
                          <td className={(dim.engaged || 0) > 0 ? 'risk-good' : ''}>{dim.engaged || 0}</td>
                          <td><strong>{dim.total}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Legenda das Faixas de Risco */}
              <div className="risk-legend">
                <h4>Legenda - Faixas de Risco</h4>
                <div className="risk-legend-items">
                  <div className="risk-legend-item">
                    <span className="risk-legend-icon">🔴</span>
                    <span className="risk-legend-label">Crítico</span>
                    <span className="risk-legend-range">&lt; 2.5</span>
                  </div>
                  <div className="risk-legend-item">
                    <span className="risk-legend-icon">🟠</span>
                    <span className="risk-legend-label">Alto Risco</span>
                    <span className="risk-legend-range">2.5 - 2.9</span>
                  </div>
                  <div className="risk-legend-item">
                    <span className="risk-legend-icon">🟡</span>
                    <span className="risk-legend-label">Risco Moderado</span>
                    <span className="risk-legend-range">3.0 - 3.4</span>
                  </div>
                  <div className="risk-legend-item">
                    <span className="risk-legend-icon">🔵</span>
                    <span className="risk-legend-label">Neutro</span>
                    <span className="risk-legend-range">3.5 - 4.1</span>
                  </div>
                  <div className="risk-legend-item">
                    <span className="risk-legend-icon">🟢</span>
                    <span className="risk-legend-label">Engajado</span>
                    <span className="risk-legend-range">≥ 4.2</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* eNPS Section - if NPS data exists */}
          {stats?.nps && (
            <div className="nps-section">
              <h3>📊 Employee Net Promoter Score (eNPS)</h3>
              <div className="nps-content">
                <div className="nps-gauge">
                  <div className="nps-gauge-value" style={{
                    color: stats.nps.score >= 75 ? '#22c55e' : stats.nps.score >= 50 ? '#84cc16' : stats.nps.score > 0 ? '#f59e0b' : '#ef4444'
                  }}>
                    {stats.nps.score}
                  </div>
                  <div className="nps-gauge-label">
                    {stats.nps.score >= 75 ? 'Zona de Excelência' :
                     stats.nps.score >= 50 ? 'Zona de Qualidade' :
                     stats.nps.score > 0 ? 'Zona de Aperfeiçoamento' :
                     'Zona Crítica'}
                  </div>
                  <div className="nps-scale-visual">
                    <div className="nps-scale-bar">
                      {/* Escala do eNPS: -100 a +100, dividida em zonas */}
                      <div className="nps-scale-section critical-zone" style={{ width: '50%' }}></div>
                      <div className="nps-scale-section improvement-zone" style={{ width: '24.5%' }}></div>
                      <div className="nps-scale-section quality-zone" style={{ width: '12.5%' }}></div>
                      <div className="nps-scale-section excellence-zone" style={{ width: '13%' }}></div>
                    </div>
                    <div className="nps-marker" style={{ 
                      left: `${((stats.nps.score + 100) / 200) * 100}%` 
                    }}>▼</div>
                    <div className="nps-scale-labels">
                      <span style={{ position: 'absolute', left: '0%' }}>-100</span>
                      <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>0</span>
                      <span style={{ position: 'absolute', left: '75%', transform: 'translateX(-50%)' }}>50</span>
                      <span style={{ position: 'absolute', left: '87.5%', transform: 'translateX(-50%)' }}>75</span>
                      <span style={{ position: 'absolute', right: '0%' }}>100</span>
                    </div>
                  </div>
                  {/* eNPS Scale Legend */}
                  <div className="nps-scale-legend">
                    <div className="nps-scale-legend-item critical">
                      <span className="nps-scale-legend-range">-100 a 0</span>
                      <span className="nps-scale-legend-label">Crítica</span>
                    </div>
                    <div className="nps-scale-legend-item improvement">
                      <span className="nps-scale-legend-range">1 a 49</span>
                      <span className="nps-scale-legend-label">Aperfeiçoamento</span>
                    </div>
                    <div className="nps-scale-legend-item quality">
                      <span className="nps-scale-legend-range">50 a 74</span>
                      <span className="nps-scale-legend-label">Qualidade</span>
                    </div>
                    <div className="nps-scale-legend-item excellence">
                      <span className="nps-scale-legend-range">75 a 100</span>
                      <span className="nps-scale-legend-label">Excelência</span>
                    </div>
                  </div>
                </div>
                <div className="nps-breakdown">
                  <div className="nps-breakdown-item promoter">
                    <div className="nps-breakdown-percent">{stats.nps.promoters}%</div>
                    <div className="nps-breakdown-label">Promotores (9-10)</div>
                    <div className="nps-breakdown-desc">Recomendam ativamente</div>
                  </div>
                  <div className="nps-breakdown-item neutral">
                    <div className="nps-breakdown-percent">{stats.nps.neutrals}%</div>
                    <div className="nps-breakdown-label">Neutros (7-8)</div>
                    <div className="nps-breakdown-desc">Satisfeitos, mas indiferentes</div>
                  </div>
                  <div className="nps-breakdown-item detractor">
                    <div className="nps-breakdown-percent">{stats.nps.detractors}%</div>
                    <div className="nps-breakdown-label">Detratores (0-6)</div>
                    <div className="nps-breakdown-desc">Podem prejudicar a reputação</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Layout em 2 colunas: Ranking + Detalhamento */}
          <div className="compact-grid">
            {/* Ranking Compacto */}
            {!departmentFilter && stats.rankingData?.length > 0 && (
              <div className="compact-card">
                <h3>🏆 Ranking</h3>
                <div className="compact-ranking">
                  {stats.rankingData.map((dept, index) => {
                    const risk = getRiskLevel(dept.score);
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}º`;
                    return (
                      <div key={dept.id} className="compact-ranking-item">
                        <span className="compact-position">{medal}</span>
                        <span className="compact-name">{dept.name}</span>
                        <div className="compact-bar-container">
                          <div className="compact-bar" style={{ width: `${(dept.score / 5) * 100}%`, backgroundColor: risk.color }} />
                        </div>
                        <span className="compact-score" style={{ color: risk.color }}>{dept.score.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Detalhamento Compacto */}
            {stats.dimensionScores?.length > 0 && (
              <div className="compact-card">
                <h3>
                  {selectedDept ? `📊 ${selectedDept.name}` : '📊 Dimensões'}
                </h3>
                <div className="compact-dimensions">
                  {stats.dimensionScores.map(dim => {
                    const risk = getRiskLevel(dim.score);
                    const shortName = dim.dimension.split(' ')[0];
                    return (
                      <div key={dim.dimension} className="compact-dimension-item" title={dim.dimension}>
                        <span className="compact-dim-name">{shortName}</span>
                        <div className="compact-bar-container">
                          <div className="compact-bar" style={{ width: `${(dim.score / 5) * 100}%`, backgroundColor: risk.color }} />
                        </div>
                        <span className="compact-score" style={{ color: risk.color }}>{dim.score.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Heatmap - Heat Map */}
          {!departmentFilter && stats.heatmapData?.length > 0 && (
            <div className="heatmap-section">
              <h3>🔥 Heat Map: Dimensões por Departamento</h3>
              <div className="heatmap-container">
                <table className="heatmap-table">
                  <thead>
                    <tr>
                      <th className="heatmap-corner">Departamento</th>
                      {/* Dynamic dimension headers from first department's data */}
                      {stats.heatmapData[0] && Object.keys(stats.heatmapData[0].dimensions || {}).map(dim => (
                        <th key={dim} className="heatmap-header">
                          <div className="heatmap-header-content">
                            <span className="heatmap-header-text">{dim}</span>
                          </div>
                        </th>
                      ))}
                      <th className="heatmap-header heatmap-header-avg">
                        <div className="heatmap-header-content">
                          <span className="heatmap-header-text">Média</span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.heatmapData.map(dept => {
                      const dimensions = Object.keys(dept.dimensions || {});
                      return (
                        <tr key={dept.id}>
                          <td className="heatmap-dept">{dept.name}</td>
                          {dimensions.map(dim => {
                            const score = dept.dimensions[dim] || 0;
                            const risk = getRiskLevel(score);
                            return (
                              <td 
                                key={dim} 
                                className="heatmap-cell"
                                style={{ backgroundColor: risk.bg, color: risk.color }}
                                title={`${dim}: ${score.toFixed(2)}`}
                              >
                                {score.toFixed(1)}
                              </td>
                            );
                          })}
                          <td 
                            className="heatmap-cell heatmap-avg"
                            style={{ backgroundColor: getRiskLevel(dept.avgScore).bg, color: getRiskLevel(dept.avgScore).color }}
                          >
                            <strong>{dept.avgScore.toFixed(2)}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <h3>Sem dados ainda</h3>
          <p>Aguardando respostas dos colaboradores para exibir os resultados.</p>
        </div>
      )}

      {/* NR-1 Notice - only show if diagnostic is NR-1 related */}
      {selectedDiag?.is_nr1 && (
        <div className="nr1-notice">
          <div className="nr1-icon">📋</div>
          <div className="nr1-content">
            <h4>Conformidade NR-1</h4>
            <p>
              Este mapa de risco psicossocial está em conformidade com a NR-1 e pode alimentar o 
              <strong> inventário de riscos do PGR</strong> (Programa de Gerenciamento de Riscos), 
              conforme exigido pelo Gerenciamento de Riscos Ocupacionais (GRO).
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// COLLABORATORS MANAGEMENT
// ==========================================

const Collaborators = ({ departments, diagnostics, showToast }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterDiagnostic, setFilterDiagnostic] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ name: '', email: '', department_id: '', diagnostic_id: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await usersApi.getCollaborators();
      setUsers(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate diagnostic_id for new users
    if (!editingUser && !formData.diagnostic_id) {
      showToast('Selecione um diagnóstico', 'error');
      return;
    }
    
    setSubmitting(true);

    try {
      if (editingUser) {
        await usersApi.update(editingUser.id, formData);
        showToast('Colaborador atualizado!', 'success');
      } else {
        const result = await usersApi.create({ ...formData, role: 'user' });
        if (result.emailSimulated) {
          showToast(`Criado! Senha temporária: ${result.tempPassword}`, 'info');
        } else {
          showToast('Colaborador criado! E-mail enviado.', 'success');
        }
      }
      setShowModal(false);
      setEditingUser(null);
      setFormData({ name: '', email: '', department_id: '', diagnostic_id: '' });
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({ name: user.name, email: user.email, department_id: user.department_id || '', diagnostic_id: user.diagnostic_id || '' });
    setShowModal(true);
  };

  const handleDelete = async (user) => {
    if (!confirm(`Excluir ${user.name}?`)) return;

    try {
      await usersApi.delete(user.id);
      showToast('Colaborador excluído!', 'success');
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleResendEmail = async (user) => {
    try {
      const result = await usersApi.resendEmail(user.id);
      if (result.emailSimulated) {
        showToast(`Nova senha: ${result.tempPassword}`, 'info');
      } else {
        showToast('E-mail reenviado!', 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchesDiagnostic = !filterDiagnostic || String(u.diagnostic_id) === filterDiagnostic;
    return matchesSearch && matchesDiagnostic;
  });

  // Get departments for selected diagnostic in form
  const formDepartments = formData.diagnostic_id 
    ? departments.filter(d => String(d.diagnostic_id) === String(formData.diagnostic_id))
    : [];

  if (loading) return <Loading />;

  return (
    <div className="management-page">
      <div className="page-header">
        <div>
          <h1>Colaboradores</h1>
          <p>Gerenciar colaboradores que participam dos diagnósticos</p>
        </div>
        <button className="btn-primary" onClick={() => {
          setEditingUser(null);
          setFormData({ name: '', email: '', department_id: '', diagnostic_id: '' });
          setShowModal(true);
        }}>
          + Adicionar
        </button>
      </div>

      <div className="filters-row">
        <div className="search-bar" style={{ flex: 1 }}>
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={filterDiagnostic}
          onChange={(e) => setFilterDiagnostic(e.target.value)}
          style={{ minWidth: '200px' }}
        >
          <option value="">Todos os diagnósticos</option>
          {diagnostics.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Diagnóstico</th>
              <th>Departamento</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td><span className="diagnostic-badge">{user.diagnostic_name || '-'}</span></td>
                <td>{user.department_name || '-'}</td>
                <td>
                  <span className={`status-badge ${user.has_responded ? 'success' : 'pending'}`}>
                    {user.has_responded ? 'Respondido' : 'Pendente'}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button onClick={() => handleEdit(user)} title="Editar">✏️</button>
                    <button onClick={() => handleResendEmail(user)} title="Reenviar e-mail">📧</button>
                    <button onClick={() => handleDelete(user)} title="Excluir" className="danger">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan="6" className="empty-cell">Nenhum colaborador encontrado</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowModal(false)}
          >
            <motion.div 
              className="modal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>{editingUser ? 'Editar Colaborador' : 'Novo Colaborador'}</h2>
              
              <form onSubmit={handleSubmit}>
                {/* Diagnóstico - obrigatório para novos, readonly para edição */}
                <div className="form-group">
                  <label>Diagnóstico *</label>
                  {editingUser ? (
                    <input
                      type="text"
                      value={diagnostics.find(d => d.id === editingUser.diagnostic_id)?.name || 'Não definido'}
                      disabled
                      className="input-disabled"
                    />
                  ) : (
                    <select
                      value={formData.diagnostic_id}
                      onChange={(e) => setFormData({ ...formData, diagnostic_id: e.target.value, department_id: '' })}
                      required
                    >
                      <option value="">Selecione o diagnóstico...</option>
                      {diagnostics.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  )}
                  {!editingUser && <small className="form-hint">O colaborador será inscrito automaticamente neste diagnóstico</small>}
                </div>

                <div className="form-group">
                  <label>Nome completo</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>E-mail</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Departamento</label>
                  <select
                    value={formData.department_id}
                    onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                    disabled={!editingUser && !formData.diagnostic_id}
                  >
                    <option value="">{!editingUser && !formData.diagnostic_id ? 'Selecione o diagnóstico primeiro' : 'Selecione...'}</option>
                    {(editingUser ? departments.filter(d => d.diagnostic_id === editingUser.diagnostic_id) : formDepartments).map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ==========================================
// DEPARTMENTS MANAGEMENT
// ==========================================

const Departments = ({ departments, loadDepartments, showToast }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (editingDept) {
        await departmentsApi.update(editingDept.id, formData);
        showToast('Departamento atualizado!', 'success');
      } else {
        await departmentsApi.create(formData);
        showToast('Departamento criado!', 'success');
      }
      setShowModal(false);
      setEditingDept(null);
      setFormData({ name: '', description: '' });
      loadDepartments();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (dept) => {
    setEditingDept(dept);
    setFormData({ name: dept.name, description: dept.description || '' });
    setShowModal(true);
  };

  const handleDelete = async (dept) => {
    if (!confirm(`Excluir ${dept.name}?`)) return;

    try {
      await departmentsApi.delete(dept.id);
      showToast('Departamento excluído!', 'success');
      loadDepartments();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="management-page">
      <div className="page-header">
        <div>
          <h1>Departamentos</h1>
          <p>Gerenciar departamentos da empresa</p>
        </div>
        <button className="btn-primary" onClick={() => {
          setEditingDept(null);
          setFormData({ name: '', description: '' });
          setShowModal(true);
        }}>
          + Adicionar
        </button>
      </div>

      <div className="dept-grid">
        {departments.map(dept => (
          <div key={dept.id} className="dept-card">
            <div className="dept-header">
              <h3>{dept.name}</h3>
              <div className="dept-actions">
                <button onClick={() => handleEdit(dept)}>✏️</button>
                <button onClick={() => handleDelete(dept)} className="danger">🗑️</button>
              </div>
            </div>
            {dept.description && <p className="dept-description">{dept.description}</p>}
            <div className="dept-stats">
              <span>👥 {dept.user_count || 0} colaboradores</span>
              <span>📝 {dept.response_count || 0} respostas</span>
            </div>
          </div>
        ))}
        {departments.length === 0 && (
          <div className="empty-state">
            <p>Nenhum departamento cadastrado</p>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowModal(false)}
          >
            <motion.div 
              className="modal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>{editingDept ? 'Editar Departamento' : 'Novo Departamento'}</h2>
              
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Nome</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Descrição (opcional)</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ==========================================
// RESPONSES VIEW
// ==========================================

const Responses = ({ departments, diagnostics, showToast }) => {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [diagnosticFilter, setDiagnosticFilter] = useState('');

  useEffect(() => {
    // Auto-select first diagnostic with responses
    if (diagnostics.length > 0 && !diagnosticFilter) {
      const firstWithResponses = diagnostics.find(d => d.response_count > 0);
      if (firstWithResponses) {
        setDiagnosticFilter(firstWithResponses.id);
      }
    }
  }, [diagnostics]);

  useEffect(() => {
    if (diagnosticFilter) {
      loadResponses();
    }
  }, [filter, diagnosticFilter]);

  const loadResponses = async () => {
    setLoading(true);
    try {
      const data = await responsesApi.getAll(filter || null, diagnosticFilter || null);
      setResponses(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (loading && diagnosticFilter) return <Loading />;

  const selectedDiag = diagnosticFilter ? diagnostics.find(d => d.id == diagnosticFilter) : null;

  return (
    <div className="management-page">
      <div className="page-header">
        <div>
          <h1>Respostas {selectedDiag ? `- ${selectedDiag.name}` : ''}</h1>
          <p>Visualização anônima das respostas do diagnóstico</p>
        </div>
        <div className="dashboard-filters">
          <select 
            className="filter-select"
            value={diagnosticFilter}
            onChange={(e) => setDiagnosticFilter(e.target.value)}
          >
            <option value="">Selecione o diagnóstico</option>
            {diagnostics.filter(d => d.response_count > 0).map(diag => (
              <option key={diag.id} value={diag.id}>{diag.name} ({diag.response_count})</option>
            ))}
          </select>
          <select 
            className="filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Todos os departamentos</option>
            {departments.map(dept => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
        </div>
      </div>

      {!diagnosticFilter ? (
        <div className="diagnostic-selector-card">
          <h3>📝 Selecione o Diagnóstico</h3>
          <p>Escolha qual diagnóstico deseja visualizar as respostas:</p>
          <div className="diagnostic-buttons">
            {diagnostics.filter(d => d.response_count > 0).map(diag => (
              <button
                key={diag.id}
                className="diagnostic-select-btn"
                onClick={() => setDiagnosticFilter(diag.id)}
              >
                <span className="diag-name">{diag.name}</span>
                <span className="diag-meta">{diag.response_count || 0} respostas</span>
              </button>
            ))}
          </div>
          {diagnostics.filter(d => d.response_count > 0).length === 0 && (
            <p className="empty-message">Nenhum diagnóstico com respostas</p>
          )}
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Departamento</th>
                <th>Índice</th>
                <th>Risco</th>
                <th>Respostas Abertas</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {responses.map(r => {
                const risk = getRiskLevel(r.score);
                return (
                  <tr key={r.id}>
                    <td>{r.index}</td>
                    <td>{r.department_name}</td>
                    <td style={{ fontWeight: 600 }}>{r.score.toFixed(2)}</td>
                    <td>
                      <span className="risk-badge" style={{ backgroundColor: risk.bg, color: risk.color }}>
                        {risk.level}
                      </span>
                    </td>
                    <td>{r.has_open_answers ? '✓ Sim' : '-'}</td>
                    <td>{new Date(r.submitted_at).toLocaleDateString('pt-BR')}</td>
                  </tr>
                );
              })}
              {responses.length === 0 && (
                <tr>
                  <td colSpan="6" className="empty-cell">Nenhuma resposta encontrada</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ==========================================
// SETTINGS (Admin Only)
// ==========================================

const Settings = ({ showToast, user }) => {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', role: 'rh' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadAdmins();
  }, []);

  const loadAdmins = async () => {
    try {
      const data = await usersApi.getAdmins();
      setAdmins(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const result = await usersApi.create(formData);
      if (result.emailSimulated) {
        showToast(`Criado! Senha: ${result.tempPassword}`, 'info');
      } else {
        showToast('Usuário criado! E-mail enviado.', 'success');
      }
      setShowModal(false);
      setFormData({ name: '', email: '', role: 'rh' });
      loadAdmins();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (admin) => {
    if (admin.id === user.id) {
      showToast('Você não pode excluir a si mesmo', 'error');
      return;
    }
    if (!confirm(`Excluir ${admin.name}?`)) return;

    try {
      await usersApi.delete(admin.id);
      showToast('Usuário excluído!', 'success');
      loadAdmins();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleClearResponses = async () => {
    if (!confirm('ATENÇÃO: Isso vai apagar TODAS as respostas. Continuar?')) return;
    if (!confirm('Tem certeza? Esta ação não pode ser desfeita!')) return;

    try {
      await responsesApi.clearAll();
      showToast('Todas as respostas foram removidas', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="management-page">
      <div className="page-header">
        <div>
          <h1>Configurações</h1>
          <p>Gerenciar usuários administrativos e configurações do sistema</p>
        </div>
      </div>

      {/* Admin Users */}
      <div className="settings-section">
        <div className="section-header">
          <h3>Usuários Administrativos</h3>
          <button className="btn-primary btn-sm" onClick={() => setShowModal(true)}>
            + Adicionar
          </button>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {admins.map(admin => (
                <tr key={admin.id}>
                  <td>{admin.name}</td>
                  <td>{admin.email}</td>
                  <td>
                    <span className={`role-badge ${admin.role}`}>
                      {admin.role === 'admin' ? 'Administrador' : 'RH'}
                    </span>
                  </td>
                  <td>
                    {admin.id !== user.id && (
                      <button onClick={() => handleDelete(admin)} className="btn-danger btn-sm">
                        Excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="settings-section danger-zone">
        <h3>⚠️ Zona de Perigo</h3>
        <p>Ações irreversíveis. Tenha certeza antes de prosseguir.</p>
        
        <button className="btn-danger" onClick={handleClearResponses}>
          Limpar todas as respostas
        </button>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowModal(false)}
          >
            <motion.div 
              className="modal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Novo Usuário Administrativo</h2>
              
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Nome completo</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>E-mail</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Perfil</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  >
                    <option value="rh">RH</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Criando...' : 'Criar'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ==========================================
// DIAGNOSTICS MANAGEMENT
// ==========================================

const DiagnosticsManagement = ({ showToast, onDiagnosticsChange, user, departments, loadDepartments }) => {
  const [diagnostics, setDiagnostics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDiagnostic, setSelectedDiagnostic] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [showTestDataModal, setShowTestDataModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState('upload'); // 'upload', 'parsing', 'preview'
  const [importData, setImportData] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [testDataCount, setTestDataCount] = useState(50);
  const [generatingTestData, setGeneratingTestData] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [createMode, setCreateMode] = useState('manual'); // 'manual' or 'ai'
  const [detailTab, setDetailTab] = useState('questions'); // 'questions', 'departments', 'collaborators', 'enrollments', 'responses', or 'access'
  const [enrollments, setEnrollments] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [diagDepartments, setDiagDepartments] = useState([]); // Departments for selected diagnostic
  const [selectedUsersToEnroll, setSelectedUsersToEnroll] = useState([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [editingDept, setEditingDept] = useState(null);
  const [rhAccess, setRhAccess] = useState([]); // RH users with access
  const [availableRH, setAvailableRH] = useState([]); // RH users without access
  // Collaborators state
  const [collaborators, setCollaborators] = useState([]);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [editingCollab, setEditingCollab] = useState(null);
  const [collabForm, setCollabForm] = useState({ name: '', email: '', department_id: '' });
  const [collabSubmitting, setCollabSubmitting] = useState(false);
  // Batch collaborators state
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchForm, setBatchForm] = useState({ quantity: 10, prefix: 'colaborador', domain: '', password: '' });
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  // Open responses state
  const [openResponses, setOpenResponses] = useState([]);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    objective: '',
    examples: '',
    questionCount: 20,
    dimensionCount: 5,
    is_nr1: false
  });
  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState({ text: '', name: '', inverted: false, type: 'likert5', options: [], is_demographic: false });
  const [editingImportQuestion, setEditingImportQuestion] = useState(null);

  const loadDiagnostics = async () => {
    try {
      const data = await diagnosticsApi.getAll();
      setDiagnostics(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDiagnostics();
  }, []);

  const loadDiagnosticDetails = async (id) => {
    try {
      const data = await diagnosticsApi.get(id);
      setSelectedDiagnostic(data);
      loadEnrollments(id);
      loadDiagDepartments(id);
      loadRHAccess(id);
      loadAvailableRH(id);
      loadCollaborators(id);
      loadDiagResponses(id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Load responses for the selected diagnostic
  const loadDiagResponses = async (diagnosticId) => {
    setResponsesLoading(true);
    try {
      const data = await responsesApi.getAll(null, diagnosticId);
      setOpenResponses(data || []);
    } catch (err) {
      console.error('Erro ao carregar respostas:', err);
      setOpenResponses([]);
    } finally {
      setResponsesLoading(false);
    }
  };

  // Load collaborators for the selected diagnostic
  const loadCollaborators = async (diagnosticId) => {
    try {
      const data = await usersApi.getCollaborators(diagnosticId);
      setCollaborators(data);
    } catch (err) {
      console.error('Erro ao carregar colaboradores:', err);
      setCollaborators([]);
    }
  };

  const handleCollabSubmit = async (e) => {
    e.preventDefault();
    setCollabSubmitting(true);

    try {
      if (editingCollab) {
        await usersApi.update(editingCollab.id, collabForm);
        showToast('Colaborador atualizado!', 'success');
      } else {
        const result = await usersApi.create({ 
          ...collabForm, 
          role: 'user',
          diagnostic_id: selectedDiagnostic.id 
        });
        if (result.emailSimulated) {
          showToast(`Criado! Senha temporária: ${result.tempPassword}`, 'info');
        } else {
          showToast('Colaborador criado! E-mail enviado.', 'success');
        }
      }
      setShowCollabModal(false);
      setEditingCollab(null);
      setCollabForm({ name: '', email: '', department_id: '' });
      loadCollaborators(selectedDiagnostic.id);
      loadEnrollments(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCollabSubmitting(false);
    }
  };

  const handleCollabEdit = (collab) => {
    setEditingCollab(collab);
    setCollabForm({ name: collab.name, email: collab.email, department_id: collab.department_id || '' });
    setShowCollabModal(true);
  };

  const handleCollabDelete = async (collab) => {
    if (!confirm(`Excluir ${collab.name}?`)) return;
    try {
      await usersApi.delete(collab.id);
      showToast('Colaborador excluído!', 'success');
      loadCollaborators(selectedDiagnostic.id);
      loadEnrollments(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCollabResendEmail = async (collab) => {
    try {
      const result = await usersApi.resendEmail(collab.id);
      if (result.emailSimulated) {
        showToast(`Nova senha: ${result.tempPassword}`, 'info');
      } else {
        showToast('E-mail reenviado!', 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    if (diagDepartments.length === 0) {
      showToast('Cadastre pelo menos 1 departamento antes de adicionar em lote', 'error');
      return;
    }
    setBatchSubmitting(true);
    try {
      const result = await usersApi.createBatch({
        quantity: parseInt(batchForm.quantity),
        prefix: batchForm.prefix,
        domain: batchForm.domain,
        password: batchForm.password,
        diagnostic_id: selectedDiagnostic.id
      });
      showToast(result.message, 'success');
      setShowBatchModal(false);
      setBatchForm({ quantity: 10, prefix: 'colaborador', domain: '', password: '' });
      loadCollaborators(selectedDiagnostic.id);
      loadEnrollments(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBatchSubmitting(false);
    }
  };

  const loadDiagDepartments = async (diagnosticId) => {
    try {
      console.log('[DEBUG] Carregando departamentos para diagnóstico:', diagnosticId);
      const data = await diagnosticsApi.getDepartments(diagnosticId);
      console.log('[DEBUG] Departamentos carregados:', data);
      setDiagDepartments(data || []);
    } catch (err) {
      console.error('Erro ao carregar departamentos:', err);
      setDiagDepartments([]);
    }
  };

  const handleAddDepartment = async () => {
    if (!newDeptName.trim() || !selectedDiagnostic) return;
    
    try {
      await diagnosticsApi.addDepartment(selectedDiagnostic.id, { name: newDeptName.trim() });
      setNewDeptName('');
      loadDiagDepartments(selectedDiagnostic.id);
      showToast('Departamento adicionado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateDepartment = async (deptId, newName) => {
    try {
      await diagnosticsApi.updateDepartment(deptId, { name: newName });
      setEditingDept(null);
      loadDiagDepartments(selectedDiagnostic.id);
      showToast('Departamento atualizado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteDepartment = async (deptId) => {
    if (!confirm('Excluir este departamento?')) return;
    
    try {
      await diagnosticsApi.deleteDepartment(deptId);
      loadDiagDepartments(selectedDiagnostic.id);
      showToast('Departamento excluído', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Import handlers
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImportStep('parsing');

    try {
      let content = null;
      let fileData = null;
      let fileType = file.type;

      // For PDFs, send as base64 for server-side extraction
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        fileData = btoa(binary);
        fileType = 'application/pdf';
      } else {
        // For text files, read as text
        content = await file.text();
      }
      
      // Send to API for parsing
      const result = await diagnosticsApi.parseDocument(content, file.name, fileData, fileType);
      
      setImportData(result.diagnostic);
      setImportSummary(result.summary);
      setImportStep('preview');
    } catch (err) {
      showToast(err.message || 'Erro ao processar documento', 'error');
      setImportStep('upload');
    }
  };

  const handleImportCreate = async () => {
    if (!importData) return;

    try {
      setGenerating(true);
      await diagnosticsApi.createFromImport({
        name: importData.name,
        description: importData.description,
        dimensions: importData.dimensions,
        status: 'draft'
      });
      
      showToast('Diagnóstico importado com sucesso!', 'success');
      setShowImportModal(false);
      setImportData(null);
      setImportStep('upload');
      loadDiagnostics();
      onDiagnosticsChange?.(); // Notify parent
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const updateImportQuestion = (dimIndex, qIndex, updates) => {
    const newData = { ...importData };
    newData.dimensions[dimIndex].questions[qIndex] = {
      ...newData.dimensions[dimIndex].questions[qIndex],
      ...updates
    };
    setImportData(newData);
  };

  const deleteImportQuestion = (dimIndex, qIndex) => {
    const newData = { ...importData };
    newData.dimensions[dimIndex].questions.splice(qIndex, 1);
    setImportData(newData);
  };

  const deleteImportDimension = (dimIndex) => {
    const newData = { ...importData };
    newData.dimensions.splice(dimIndex, 1);
    setImportData(newData);
  };

  const updateImportDimension = (dimIndex, name) => {
    const newData = { ...importData };
    newData.dimensions[dimIndex].name = name;
    setImportData(newData);
  };

  const loadEnrollments = async (diagnosticId) => {
    try {
      const data = await diagnosticsApi.getEnrollments(diagnosticId);
      setEnrollments(data);
    } catch (err) {
      console.error('Erro ao carregar inscrições:', err);
    }
  };

  const loadAvailableUsers = async () => {
    if (!selectedDiagnostic) return;
    try {
      const data = await diagnosticsApi.getAvailableUsers(selectedDiagnostic.id);
      setAvailableUsers(data);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleEnrollUsers = async () => {
    if (selectedUsersToEnroll.length === 0) {
      showToast('Selecione pelo menos um usuário', 'error');
      return;
    }
    try {
      await diagnosticsApi.enrollUsers(selectedDiagnostic.id, selectedUsersToEnroll);
      showToast('Usuários inscritos com sucesso', 'success');
      setShowEnrollModal(false);
      setSelectedUsersToEnroll([]);
      loadEnrollments(selectedDiagnostic.id);
      loadDiagnostics();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleEnrollDepartment = async (deptId) => {
    try {
      await diagnosticsApi.enrollDepartment(selectedDiagnostic.id, deptId);
      showToast('Departamento inscrito com sucesso', 'success');
      loadEnrollments(selectedDiagnostic.id);
      loadAvailableUsers();
      loadDiagnostics();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleEnrollAll = async () => {
    if (!confirm('Inscrever TODOS os colaboradores neste diagnóstico?')) return;
    try {
      await diagnosticsApi.enrollAll(selectedDiagnostic.id);
      showToast('Todos os usuários inscritos', 'success');
      loadEnrollments(selectedDiagnostic.id);
      loadDiagnostics();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleRemoveEnrollment = async (userId) => {
    if (!confirm('Remover inscrição deste usuário?')) return;
    try {
      await diagnosticsApi.removeEnrollment(selectedDiagnostic.id, userId);
      showToast('Inscrição removida', 'success');
      loadEnrollments(selectedDiagnostic.id);
      loadDiagnostics();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // RH Access Management
  const loadRHAccess = async (diagnosticId) => {
    try {
      const data = await diagnosticsApi.getAccess(diagnosticId);
      setRhAccess(data);
    } catch (err) {
      console.error('Erro ao carregar acessos RH:', err);
    }
  };

  const loadAvailableRH = async (diagnosticId) => {
    try {
      const data = await diagnosticsApi.getAvailableRH(diagnosticId);
      setAvailableRH(data);
    } catch (err) {
      console.error('Erro ao carregar RHs disponíveis:', err);
    }
  };

  const handleGrantAccess = async (userId) => {
    try {
      await diagnosticsApi.grantAccess(selectedDiagnostic.id, userId);
      showToast('Acesso concedido', 'success');
      loadRHAccess(selectedDiagnostic.id);
      loadAvailableRH(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleRevokeAccess = async (userId) => {
    if (!confirm('Remover acesso deste RH?')) return;
    try {
      await diagnosticsApi.revokeAccess(selectedDiagnostic.id, userId);
      showToast('Acesso removido', 'success');
      loadRHAccess(selectedDiagnostic.id);
      loadAvailableRH(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleGenerateTestData = async () => {
    if (!confirm(`Gerar ${testDataCount} respostas de teste? Isso criará usuários fictícios.`)) return;
    setGeneratingTestData(true);
    try {
      const result = await diagnosticsApi.generateTestData(selectedDiagnostic.id, testDataCount);
      showToast(`${result.created.responses} respostas geradas com sucesso!`, 'success');
      setShowTestDataModal(false);
      loadEnrollments(selectedDiagnostic.id);
      loadDiagnostics();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setGeneratingTestData(false);
    }
  };

  const handleClearTestData = async () => {
    if (!confirm('Remover TODOS os dados de teste (usuários @cuidarmais.com.br e suas respostas)?')) return;
    try {
      const result = await diagnosticsApi.clearTestData(selectedDiagnostic.id);
      showToast(`${result.deleted} usuários de teste removidos`, 'success');
      loadEnrollments(selectedDiagnostic.id);
      loadDiagnostics();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCreateManual = async () => {
    try {
      const newDiag = await diagnosticsApi.create({
        name: formData.name,
        description: formData.description,
        status: 'draft',
        is_nr1: formData.is_nr1
      });
      showToast('Diagnóstico criado! Adicione as dimensões e perguntas.', 'success');
      setShowCreateModal(false);
      setFormData({ name: '', description: '', objective: '', examples: '', questionCount: 20, dimensionCount: 5, is_nr1: false });
      loadDiagnostics();
      onDiagnosticsChange?.(); // Notify parent
      loadDiagnosticDetails(newDiag.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleGenerateAI = async () => {
    setGenerating(true);
    try {
      const newDiag = await diagnosticsApi.generate({
        name: formData.name,
        objective: formData.objective,
        examples: formData.examples,
        questionCount: formData.questionCount,
        dimensionCount: formData.dimensionCount,
        is_nr1: formData.is_nr1
      });
      showToast('Diagnóstico gerado com sucesso!', 'success');
      setShowCreateModal(false);
      setFormData({ name: '', description: '', objective: '', examples: '', questionCount: 20, dimensionCount: 5, is_nr1: false });
      loadDiagnostics();
      onDiagnosticsChange?.(); // Notify parent
      loadDiagnosticDetails(newDiag.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await diagnosticsApi.update(id, { status });
      showToast(`Status alterado para ${status === 'active' ? 'Ativo' : status === 'inactive' ? 'Inativo' : 'Rascunho'}`, 'success');
      loadDiagnostics();
      if (selectedDiagnostic?.id === id) {
        loadDiagnosticDetails(id);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteDiagnostic = async (id) => {
    if (!confirm('Tem certeza que deseja excluir este diagnóstico?')) return;
    try {
      await diagnosticsApi.delete(id);
      showToast('Diagnóstico excluído', 'success');
      setSelectedDiagnostic(null);
      loadDiagnostics();
      onDiagnosticsChange?.(); // Notify parent to refresh its list
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleAddDimension = async () => {
    const name = prompt('Nome da nova dimensão:');
    if (!name) return;
    try {
      await diagnosticsApi.addDimension(selectedDiagnostic.id, { name });
      showToast('Dimensão adicionada', 'success');
      loadDiagnosticDetails(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleAddQuestion = async (dimensionId) => {
    setEditingItem({ type: 'new-question', dimensionId });
    setEditForm({ text: '', inverted: false, type: 'likert5', options: [], is_demographic: false });
    setShowEditModal(true);
  };

  const handleSaveNewQuestion = async () => {
    if (!editForm.text.trim()) {
      showToast('Digite o texto da pergunta', 'error');
      return;
    }
    try {
      await diagnosticsApi.addQuestion(editingItem.dimensionId, { 
        text: editForm.text, 
        inverted: editForm.inverted,
        type: editForm.type,
        options: ['single_choice', 'multiple_choice'].includes(editForm.type) ? editForm.options : null,
        is_demographic: editForm.is_demographic
      });
      showToast('Pergunta adicionada', 'success');
      setShowEditModal(false);
      loadDiagnosticDetails(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleEditDimension = (dim) => {
    setEditingItem({ type: 'dimension', id: dim.id });
    setEditForm({ name: dim.name });
    setShowEditModal(true);
  };

  const handleEditQuestion = (q) => {
    setEditingItem({ type: 'question', id: q.id });
    setEditForm({ 
      text: q.text, 
      inverted: q.inverted,
      type: q.type || 'likert5',
      options: q.options || [],
      is_demographic: q.is_demographic || false
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    try {
      if (editingItem.type === 'diagnostic') {
        await diagnosticsApi.update(editingItem.id, { 
          name: editForm.name, 
          description: editForm.description,
          is_nr1: editForm.is_nr1
        });
        loadDiagnostics();
      } else if (editingItem.type === 'dimension') {
        await diagnosticsApi.updateDimension(editingItem.id, { name: editForm.name });
      } else {
        await diagnosticsApi.updateQuestion(editingItem.id, { 
          text: editForm.text, 
          inverted: editForm.inverted,
          type: editForm.type,
          options: ['single_choice', 'multiple_choice'].includes(editForm.type) ? editForm.options : null,
          is_demographic: editForm.is_demographic
        });
      }
      showToast('Alteração salva', 'success');
      setShowEditModal(false);
      loadDiagnosticDetails(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteDimension = async (id) => {
    if (!confirm('Excluir esta dimensão e todas suas perguntas?')) return;
    try {
      await diagnosticsApi.deleteDimension(id);
      showToast('Dimensão excluída', 'success');
      loadDiagnosticDetails(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteQuestion = async (id) => {
    if (!confirm('Excluir esta pergunta?')) return;
    try {
      await diagnosticsApi.deleteQuestion(id);
      showToast('Pergunta excluída', 'success');
      loadDiagnosticDetails(selectedDiagnostic.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="management-page">
      <div className="page-header">
        <div>
          <h2>🧠 Gerenciar Diagnósticos</h2>
          <p>Crie e edite diagnósticos para sua empresa</p>
        </div>
        <div className="header-buttons">
          <button className="btn-secondary" onClick={() => { setShowImportModal(true); setImportStep('upload'); setImportData(null); }}>
            📄 Importar Documento
          </button>
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            + Novo Diagnóstico
          </button>
        </div>
      </div>

      <div className="diagnostics-layout">
        {/* Lista de Diagnósticos */}
        <div className="diagnostics-list">
          <h3>Diagnósticos</h3>
          {diagnostics.length === 0 ? (
            <p className="empty-message">Nenhum diagnóstico criado</p>
          ) : (
            diagnostics.map(diag => (
              <div 
                key={diag.id} 
                className={`diagnostic-item ${selectedDiagnostic?.id === diag.id ? 'selected' : ''}`}
                onClick={() => loadDiagnosticDetails(diag.id)}
              >
                <div className="diagnostic-item-header">
                  <span className="diagnostic-name">{diag.name}</span>
                  <span className={`status-badge status-${diag.status}`}>
                    {diag.status === 'active' ? 'Ativo' : diag.status === 'inactive' ? 'Inativo' : 'Rascunho'}
                  </span>
                </div>
                <div className="diagnostic-item-meta">
                  {diag.dimension_count} dimensões · {diag.question_count} perguntas · {diag.response_count} respostas
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detalhes do Diagnóstico */}
        <div className="diagnostic-details">
          {selectedDiagnostic ? (
            <>
              <div className="detail-header">
                <div className="detail-title-row">
                  <div>
                    <h3>{selectedDiagnostic.name}</h3>
                    <p>{selectedDiagnostic.description}</p>
                  </div>
                  <button 
                    className="btn-icon"
                    onClick={() => {
                      setEditingItem({ type: 'diagnostic', id: selectedDiagnostic.id });
                      setEditForm({ name: selectedDiagnostic.name, description: selectedDiagnostic.description || '', is_nr1: selectedDiagnostic.is_nr1 || false });
                      setShowEditModal(true);
                    }}
                    title="Editar nome e descrição"
                  >
                    ✏️
                  </button>
                </div>
                <div className="detail-actions">
                  <button 
                    className="btn-secondary btn-sm"
                    onClick={() => setShowTestDataModal(true)}
                    title="Gerar dados de teste"
                  >
                    🎲 Dados Teste
                  </button>
                  <select 
                    value={selectedDiagnostic.status} 
                    onChange={(e) => handleStatusChange(selectedDiagnostic.id, e.target.value)}
                    className="status-select"
                  >
                    <option value="draft">Rascunho</option>
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                  <button className="btn-danger btn-sm" onClick={() => handleDeleteDiagnostic(selectedDiagnostic.id)}>
                    Excluir
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="detail-tabs">
                <button 
                  className={`detail-tab ${detailTab === 'questions' ? 'active' : ''}`}
                  onClick={() => setDetailTab('questions')}
                >
                  📝 Perguntas ({selectedDiagnostic.dimensions?.reduce((sum, d) => sum + (d.questions?.length || 0), 0) || 0})
                </button>
                <button 
                  className={`detail-tab ${detailTab === 'departments' ? 'active' : ''}`}
                  onClick={() => setDetailTab('departments')}
                >
                  🏢 Departamentos ({diagDepartments.length})
                </button>
                <button 
                  className={`detail-tab ${detailTab === 'collaborators' ? 'active' : ''}`}
                  onClick={() => setDetailTab('collaborators')}
                >
                  👤 Colaboradores ({collaborators.length})
                </button>
                <button 
                  className={`detail-tab ${detailTab === 'enrollments' ? 'active' : ''}`}
                  onClick={() => setDetailTab('enrollments')}
                >
                  ✅ Inscritos ({enrollments.length})
                </button>
                <button 
                  className={`detail-tab ${detailTab === 'responses' ? 'active' : ''}`}
                  onClick={() => setDetailTab('responses')}
                >
                  💬 Respostas ({openResponses.length})
                </button>
                {user?.role === 'admin' && (
                  <button 
                    className={`detail-tab ${detailTab === 'access' ? 'active' : ''}`}
                    onClick={() => setDetailTab('access')}
                  >
                    🔐 Acessos RH ({rhAccess.length})
                  </button>
                )}
              </div>

              {/* Departments Tab */}
              {detailTab === 'departments' && (
                <div className="departments-container">
                  <p className="tab-description">
                    Departamentos são específicos deste diagnóstico. Os colaboradores escolherão seu departamento ao responder.
                  </p>
                  
                  <div className="add-dept-form">
                    <input
                      type="text"
                      placeholder="Nome do departamento"
                      value={newDeptName}
                      onChange={(e) => setNewDeptName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddDepartment()}
                    />
                    <button className="btn-primary" onClick={handleAddDepartment} disabled={!newDeptName.trim()}>
                      + Adicionar
                    </button>
                  </div>

                  {diagDepartments.length === 0 ? (
                    <div className="empty-state">
                      <p>Nenhum departamento cadastrado.</p>
                      <p className="small">Adicione departamentos para que os colaboradores possam se identificar.</p>
                    </div>
                  ) : (
                    <div className="dept-list">
                      {diagDepartments.map(dept => (
                        <div key={dept.id} className="dept-item">
                          {editingDept?.id === dept.id ? (
                            <div className="dept-edit-form">
                              <input
                                type="text"
                                value={editingDept.name}
                                onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })}
                                autoFocus
                              />
                              <button className="btn-sm" onClick={() => handleUpdateDepartment(dept.id, editingDept.name)}>✓</button>
                              <button className="btn-sm" onClick={() => setEditingDept(null)}>✕</button>
                            </div>
                          ) : (
                            <>
                              <span className="dept-name">🏢 {dept.name}</span>
                              <div className="dept-actions">
                                <button className="btn-xs" onClick={() => setEditingDept({ id: dept.id, name: dept.name })}>✏️</button>
                                <button className="btn-xs btn-danger" onClick={() => handleDeleteDepartment(dept.id)}>🗑️</button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Questions Tab */}
              {detailTab === 'questions' && (
                <div className="dimensions-container">
                  {selectedDiagnostic.dimensions?.map(dim => (
                    <div key={dim.id} className="dimension-card">
                      <div className="dimension-header">
                        <h4>📁 {dim.name}</h4>
                        <div className="dimension-actions">
                          <button className="btn-sm" onClick={() => handleEditDimension(dim)}>✏️</button>
                          <button className="btn-sm btn-danger" onClick={() => handleDeleteDimension(dim.id)}>🗑️</button>
                        </div>
                      </div>
                      <div className="questions-list">
                        {dim.questions?.map((q, idx) => (
                          <div key={q.id} className="question-item">
                            <span className="question-number">{idx + 1}.</span>
                            <span className="question-text">{q.text}</span>
                            <span className={`type-badge type-${q.type || 'likert5'}`}>
                              {q.type === 'likert5' ? 'Likert 1-5' :
                               q.type === 'likert10' ? 'Likert 0-10' :
                               q.type === 'nps' ? 'NPS' :
                               q.type === 'yes_no' ? 'Sim/Não' :
                               q.type === 'single_choice' ? 'Escolha única' :
                               q.type === 'multiple_choice' ? 'Múltipla escolha' :
                               q.type === 'open' ? 'Aberta' : 'Likert 1-5'}
                            </span>
                            {q.inverted && <span className="inverted-badge">invertida</span>}
                            {q.is_demographic && <span className="demographic-badge">📊 filtro</span>}
                            <div className="question-actions">
                              <button className="btn-xs" onClick={() => handleEditQuestion(q)}>✏️</button>
                              <button className="btn-xs btn-danger" onClick={() => handleDeleteQuestion(q.id)}>🗑️</button>
                            </div>
                          </div>
                        ))}
                        <button className="btn-add-question" onClick={() => handleAddQuestion(dim.id)}>
                          + Adicionar pergunta
                        </button>
                      </div>
                    </div>
                  ))}
                  <button className="btn-add-dimension" onClick={handleAddDimension}>
                    + Adicionar dimensão
                  </button>
                </div>
              )}

              {/* Collaborators Tab */}
              {detailTab === 'collaborators' && (
                <div className="collaborators-tab-container">
                  <div className="tab-header-actions">
                    <p className="tab-description">
                      Colaboradores que participam deste diagnóstico.
                    </p>
                    <div className="btn-group-collab">
                      <button className="btn-primary" onClick={() => {
                        setEditingCollab(null);
                        setCollabForm({ name: '', email: '', department_id: '' });
                        setShowCollabModal(true);
                      }}>
                        + Adicionar
                      </button>
                      <button className="btn-secondary" onClick={() => setShowBatchModal(true)}>
                        📋 Adicionar em Lote
                      </button>
                    </div>
                  </div>

                  {collaborators.length === 0 ? (
                    <div className="empty-state">
                      <p>Nenhum colaborador cadastrado neste diagnóstico.</p>
                      <small>Adicione colaboradores para que possam responder.</small>
                    </div>
                  ) : (
                    <div className="collaborators-list">
                      {collaborators.map(collab => (
                        <div key={collab.id} className={`collab-item ${collab.has_responded ? 'responded' : ''}`}>
                          <div className="collab-info">
                            <span className="collab-name">{collab.name}</span>
                            <span className="collab-email">{collab.email}</span>
                            <span className="collab-dept">{collab.department_name || 'Sem departamento'}</span>
                          </div>
                          <div className="collab-status">
                            {collab.has_responded ? (
                              <span className="status-responded">✓ Respondeu</span>
                            ) : (
                              <span className="status-pending">Pendente</span>
                            )}
                          </div>
                          <div className="collab-actions">
                            <button onClick={() => handleCollabEdit(collab)} title="Editar">✏️</button>
                            <button onClick={() => handleCollabResendEmail(collab)} title="Reenviar e-mail">📧</button>
                            <button onClick={() => handleCollabDelete(collab)} title="Excluir" className="danger">🗑️</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Enrollments Tab */}
              {detailTab === 'enrollments' && (
                <div className="enrollments-container">
                  <div className="enrollment-actions">
                    <button className="btn-primary" onClick={() => { loadAvailableUsers(); setShowEnrollModal(true); }}>
                      + Inscrever Usuários
                    </button>
                    <button className="btn-secondary" onClick={handleEnrollAll}>
                      Inscrever Todos
                    </button>
                  </div>

                  <div className="enrollment-stats">
                    <div className="enrollment-stat">
                      <span className="stat-value">{enrollments.length}</span>
                      <span className="stat-label">Inscritos</span>
                    </div>
                    <div className="enrollment-stat">
                      <span className="stat-value">{enrollments.filter(e => e.has_responded).length}</span>
                      <span className="stat-label">Responderam</span>
                    </div>
                    <div className="enrollment-stat">
                      <span className="stat-value">{enrollments.filter(e => !e.has_responded).length}</span>
                      <span className="stat-label">Pendentes</span>
                    </div>
                  </div>

                  {enrollments.length === 0 ? (
                    <p className="empty-message">Nenhum usuário inscrito neste diagnóstico</p>
                  ) : (
                    <div className="enrollments-list">
                      {enrollments.map(user => (
                        <div key={user.id} className={`enrollment-item ${user.has_responded ? 'responded' : ''}`}>
                          <div className="enrollment-info">
                            <span className="enrollment-name">{user.name}</span>
                            <span className="enrollment-email">{user.email}</span>
                            <span className="enrollment-dept">{user.department_name || 'Sem departamento'}</span>
                          </div>
                          <div className="enrollment-status">
                            {user.has_responded ? (
                              <span className="status-responded">✓ Respondeu</span>
                            ) : (
                              <>
                                <span className="status-pending">Pendente</span>
                                <button 
                                  className="btn-xs btn-danger" 
                                  onClick={() => handleRemoveEnrollment(user.id)}
                                >
                                  🗑️
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Responses Tab */}
              {detailTab === 'responses' && (
                <div className="responses-tab-container">
                  <p className="tab-description">
                    Visualização anônima das respostas recebidas.
                  </p>

                  {responsesLoading ? (
                    <div className="loading-small">Carregando...</div>
                  ) : openResponses.length === 0 ? (
                    <div className="empty-state">
                      <p>Nenhuma resposta recebida ainda.</p>
                      <small>As respostas aparecerão aqui conforme os colaboradores respondem.</small>
                    </div>
                  ) : (
                    <div className="responses-table-container">
                      <table className="responses-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Departamento</th>
                            <th>Índice</th>
                            <th>Risco</th>
                            <th>Data</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openResponses.map((r, idx) => {
                            const score = r.score || 0;
                            let riskLevel = '🟢 Engajado';
                            let riskClass = 'risk-good';
                            if (score < 2.5) { riskLevel = '🔴 Crítico'; riskClass = 'risk-critical'; }
                            else if (score < 3.0) { riskLevel = '🟠 Alto Risco'; riskClass = 'risk-high'; }
                            else if (score < 3.5) { riskLevel = '🟡 Moderado'; riskClass = 'risk-moderate'; }
                            else if (score < 4.2) { riskLevel = '🔵 Neutro'; riskClass = 'risk-neutral'; }
                            
                            return (
                              <tr key={r.id}>
                                <td>{idx + 1}</td>
                                <td>{r.department_name || '-'}</td>
                                <td className="score-cell">{score.toFixed(2)}</td>
                                <td><span className={`risk-tag ${riskClass}`}>{riskLevel}</span></td>
                                <td>{new Date(r.submitted_at).toLocaleDateString('pt-BR')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Access Tab (Admin only) */}
              {detailTab === 'access' && user?.role === 'admin' && (
                <div className="access-container">
                  <p className="tab-description">
                    Defina quais usuários RH podem visualizar o dashboard e resultados deste diagnóstico.
                  </p>

                  {/* RH users with access */}
                  <div className="access-section">
                    <h4>🔓 RHs com acesso ({rhAccess.length})</h4>
                    {rhAccess.length === 0 ? (
                      <p className="empty-message">Nenhum RH tem acesso a este diagnóstico</p>
                    ) : (
                      <div className="access-list">
                        {rhAccess.map(u => (
                          <div key={u.id} className="access-item">
                            <div className="access-info">
                              <span className="access-name">{u.name}</span>
                              <span className="access-email">{u.email}</span>
                            </div>
                            <button 
                              className="btn-xs btn-danger" 
                              onClick={() => handleRevokeAccess(u.id)}
                              title="Remover acesso"
                            >
                              🗑️
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* RH users without access */}
                  {availableRH.length > 0 && (
                    <div className="access-section">
                      <h4>🔒 RHs sem acesso ({availableRH.length})</h4>
                      <div className="access-list">
                        {availableRH.map(u => (
                          <div key={u.id} className="access-item">
                            <div className="access-info">
                              <span className="access-name">{u.name}</span>
                              <span className="access-email">{u.email}</span>
                            </div>
                            <button 
                              className="btn-xs btn-primary" 
                              onClick={() => handleGrantAccess(u.id)}
                              title="Conceder acesso"
                            >
                              + Dar acesso
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {availableRH.length === 0 && rhAccess.length > 0 && (
                    <p className="info-message">✓ Todos os RHs já têm acesso a este diagnóstico</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="empty-details">
              <p>Selecione um diagnóstico para ver os detalhes</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal Inscrever Usuários */}
      <AnimatePresence>
        {showEnrollModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowEnrollModal(false)}
          >
            <motion.div 
              className="modal modal-large"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Inscrever Colaboradores</h2>
              
              <p className="modal-description">
                Colaboradores deste diagnóstico que ainda não estão inscritos:
              </p>

              {/* Individual selection */}
              <div className="available-users-list">
                {availableUsers.length === 0 ? (
                  <div className="empty-state-small">
                    <p>✓ Todos os colaboradores já estão inscritos</p>
                    <small>Adicione novos colaboradores na tela "Colaboradores"</small>
                  </div>
                ) : (
                  availableUsers.map(user => (
                    <label key={user.id} className="user-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedUsersToEnroll.includes(user.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedUsersToEnroll([...selectedUsersToEnroll, user.id]);
                          } else {
                            setSelectedUsersToEnroll(selectedUsersToEnroll.filter(id => id !== user.id));
                          }
                        }}
                      />
                      <span className="user-info">
                        <span className="user-name">{user.name}</span>
                        <span className="user-dept">{user.department_name || 'Sem departamento'}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>

              <div className="btn-group">
                <button className="btn-secondary" onClick={() => setShowEnrollModal(false)}>
                  Fechar
                </button>
                {availableUsers.length > 0 && (
                  <button 
                    className="btn-primary" 
                    onClick={handleEnrollUsers}
                    disabled={selectedUsersToEnroll.length === 0}
                  >
                    Inscrever {selectedUsersToEnroll.length > 0 ? `(${selectedUsersToEnroll.length})` : ''}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Importar Documento */}
      <AnimatePresence>
        {showImportModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !generating && setShowImportModal(false)}
          >
            <motion.div 
              className={`modal ${importStep === 'preview' ? 'modal-xl' : ''}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Upload Step */}
              {importStep === 'upload' && (
                <>
                  <h2>📄 Importar Diagnóstico</h2>
                  <p style={{ marginBottom: '20px', color: '#64748b' }}>
                    Faça upload de um documento com a estrutura do diagnóstico. 
                    A IA vai interpretar e criar automaticamente.
                  </p>

                  <div className="upload-area">
                    <input
                      type="file"
                      accept=".txt,.pdf,.doc,.docx"
                      onChange={handleFileUpload}
                      id="import-file"
                      style={{ display: 'none' }}
                    />
                    <label htmlFor="import-file" className="upload-label">
                      <span className="upload-icon">📎</span>
                      <span>Arraste o arquivo aqui ou clique para selecionar</span>
                      <span className="upload-formats">TXT, PDF, DOC, DOCX</span>
                    </label>
                  </div>

                  <div className="btn-group" style={{ marginTop: '24px' }}>
                    <button className="btn-secondary" onClick={() => setShowImportModal(false)}>
                      Cancelar
                    </button>
                  </div>
                </>
              )}

              {/* Parsing Step */}
              {importStep === 'parsing' && (
                <div className="parsing-state">
                  <div className="parsing-spinner"></div>
                  <h3>Analisando documento...</h3>
                  <p>A IA está interpretando a estrutura do diagnóstico</p>
                </div>
              )}

              {/* Preview Step */}
              {importStep === 'preview' && importData && (
                <>
                  <div className="import-header">
                    <h2>✅ Diagnóstico interpretado!</h2>
                    <p>Revise e edite antes de criar</p>
                  </div>

                  <div className="import-name-edit">
                    <label>Nome do diagnóstico:</label>
                    <input
                      type="text"
                      value={importData.name}
                      onChange={(e) => setImportData({ ...importData, name: e.target.value })}
                    />
                  </div>

                  <div className="import-preview">
                    {importData.dimensions?.map((dim, dimIndex) => (
                      <div key={dimIndex} className="import-dimension">
                        <div className="import-dim-header">
                          <span className="import-dim-icon">📁</span>
                          {editingImportQuestion?.type === 'dimension' && editingImportQuestion.dimIndex === dimIndex ? (
                            <input
                              type="text"
                              value={dim.name}
                              onChange={(e) => updateImportDimension(dimIndex, e.target.value)}
                              onBlur={() => setEditingImportQuestion(null)}
                              onKeyDown={(e) => e.key === 'Enter' && setEditingImportQuestion(null)}
                              autoFocus
                            />
                          ) : (
                            <span className="import-dim-name" onClick={() => setEditingImportQuestion({ type: 'dimension', dimIndex })}>
                              {dim.name}
                            </span>
                          )}
                          <button className="btn-xs btn-danger" onClick={() => deleteImportDimension(dimIndex)}>🗑️</button>
                        </div>

                        <div className="import-questions">
                          {dim.questions?.map((q, qIndex) => (
                            <div key={qIndex} className="import-question">
                              <span className="import-q-num">{qIndex + 1}.</span>
                              <span className="import-q-text">{q.text}</span>
                              <span className={`type-badge type-${q.type}`}>
                                {q.type === 'likert5' ? '⭐ Likert' :
                                 q.type === 'nps' ? '📊 NPS' :
                                 q.type === 'yes_no' ? '✓/✕ Sim/Não' :
                                 q.type === 'single_choice' ? `📋 ${q.options?.length || 0} opções` :
                                 q.type === 'open' ? '💬 Aberta' : q.type}
                              </span>
                              {q.inverted && <span className="inverted-badge">invertida</span>}
                              {q.is_demographic && <span className="demographic-badge">📊 filtro</span>}
                              <div className="import-q-actions">
                                <button 
                                  className="btn-xs" 
                                  onClick={() => setEditingImportQuestion({ type: 'question', dimIndex, qIndex, data: { ...q } })}
                                >
                                  ✏️
                                </button>
                                <button className="btn-xs btn-danger" onClick={() => deleteImportQuestion(dimIndex, qIndex)}>🗑️</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="import-summary">
                    📊 Resumo: {importData.dimensions?.length || 0} dimensões · {importData.dimensions?.reduce((sum, d) => sum + (d.questions?.length || 0), 0) || 0} perguntas
                    {importSummary?.npsQuestions > 0 && ` · ${importSummary.npsQuestions} NPS`}
                    {importSummary?.openQuestions > 0 && ` · ${importSummary.openQuestions} abertas`}
                  </div>

                  <div className="btn-group" style={{ marginTop: '20px' }}>
                    <button className="btn-secondary" onClick={() => { setImportStep('upload'); setImportData(null); }}>
                      ← Voltar
                    </button>
                    <button className="btn-primary" onClick={handleImportCreate} disabled={generating}>
                      {generating ? 'Criando...' : '✅ Criar Diagnóstico'}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Editar Pergunta Importada */}
      <AnimatePresence>
        {editingImportQuestion?.type === 'question' && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEditingImportQuestion(null)}
          >
            <motion.div 
              className="modal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Editar Pergunta</h2>
              
              <div className="form-group">
                <label>Texto</label>
                <textarea
                  value={editingImportQuestion.data.text}
                  onChange={(e) => setEditingImportQuestion({
                    ...editingImportQuestion,
                    data: { ...editingImportQuestion.data, text: e.target.value }
                  })}
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Tipo</label>
                <select
                  value={editingImportQuestion.data.type}
                  onChange={(e) => setEditingImportQuestion({
                    ...editingImportQuestion,
                    data: { ...editingImportQuestion.data, type: e.target.value, options: e.target.value === 'single_choice' ? editingImportQuestion.data.options || [] : null }
                  })}
                >
                  <option value="likert5">Escala Likert 1-5</option>
                  <option value="nps">eNPS (0-10)</option>
                  <option value="yes_no">Sim / Não</option>
                  <option value="single_choice">Escolha única</option>
                  <option value="open">Resposta aberta</option>
                </select>
              </div>

              {editingImportQuestion.data.type === 'single_choice' && (
                <div className="form-group">
                  <label>Opções (uma por linha)</label>
                  <textarea
                    value={(editingImportQuestion.data.options || []).join('\n')}
                    onChange={(e) => setEditingImportQuestion({
                      ...editingImportQuestion,
                      data: { ...editingImportQuestion.data, options: e.target.value.split('\n').filter(o => o.trim()) }
                    })}
                    rows={5}
                    placeholder="Opção 1&#10;Opção 2&#10;Opção 3"
                  />
                </div>
              )}

              {['likert5', 'nps'].includes(editingImportQuestion.data.type) && (
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editingImportQuestion.data.inverted || false}
                      onChange={(e) => setEditingImportQuestion({
                        ...editingImportQuestion,
                        data: { ...editingImportQuestion.data, inverted: e.target.checked }
                      })}
                    />
                    Pergunta invertida
                  </label>
                </div>
              )}

              <div className="btn-group">
                <button className="btn-secondary" onClick={() => setEditingImportQuestion(null)}>
                  Cancelar
                </button>
                <button 
                  className="btn-primary" 
                  onClick={() => {
                    updateImportQuestion(
                      editingImportQuestion.dimIndex, 
                      editingImportQuestion.qIndex, 
                      editingImportQuestion.data
                    );
                    setEditingImportQuestion(null);
                  }}
                >
                  Salvar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Gerar Dados de Teste */}
      <AnimatePresence>
        {showTestDataModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowTestDataModal(false)}
          >
            <motion.div 
              className="modal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>🎲 Gerar Dados de Teste</h2>
              <p style={{ marginBottom: '20px', color: '#64748b' }}>
                Cria usuários fictícios com respostas realistas para simular cenários no dashboard.
              </p>

              <div className="form-group">
                <label>Quantidade de respostas</label>
                <input
                  type="number"
                  min="10"
                  max="500"
                  value={testDataCount}
                  onChange={(e) => setTestDataCount(parseInt(e.target.value) || 50)}
                />
                <small style={{ color: '#94a3b8' }}>Entre 10 e 500 respostas</small>
              </div>

              <div className="test-data-info">
                <p>📧 Serão criados usuários com e-mail @cuidarmais.com.br</p>
                <p>🏢 Distribuídos entre os departamentos existentes</p>
                <p>📊 Respostas com variação realista por dimensão</p>
              </div>

              <div className="btn-group" style={{ marginTop: '24px' }}>
                <button 
                  className="btn-danger"
                  onClick={handleClearTestData}
                >
                  🗑️ Limpar Dados Teste
                </button>
                <button className="btn-secondary" onClick={() => setShowTestDataModal(false)}>
                  Cancelar
                </button>
                <button 
                  className="btn-primary" 
                  onClick={handleGenerateTestData}
                  disabled={generatingTestData}
                >
                  {generatingTestData ? 'Gerando...' : `Gerar ${testDataCount} Respostas`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Criar */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div 
              className="modal modal-large"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Criar Novo Diagnóstico</h2>
              
              <div className="create-mode-tabs">
                <button 
                  className={`mode-tab ${createMode === 'ai' ? 'active' : ''}`}
                  onClick={() => setCreateMode('ai')}
                >
                  🤖 Gerar com IA
                </button>
                <button 
                  className={`mode-tab ${createMode === 'manual' ? 'active' : ''}`}
                  onClick={() => setCreateMode('manual')}
                >
                  ✍️ Criar Manual
                </button>
              </div>

              <div className="form-group">
                <label>Nome do Diagnóstico *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Clima Organizacional, Engajamento..."
                  required
                />
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.is_nr1}
                    onChange={(e) => setFormData({ ...formData, is_nr1: e.target.checked })}
                  />
                  <span>📋 Diagnóstico relacionado à NR-1</span>
                </label>
                <small className="form-hint">Marque se este diagnóstico será usado para conformidade com a NR-1</small>
              </div>

              {createMode === 'ai' ? (
                <>
                  <div className="form-group">
                    <label>Objetivo do Diagnóstico *</label>
                    <textarea
                      value={formData.objective}
                      onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
                      placeholder="Descreva o que você quer avaliar..."
                      rows={3}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Exemplos de perguntas (opcional)</label>
                    <textarea
                      value={formData.examples}
                      onChange={(e) => setFormData({ ...formData, examples: e.target.value })}
                      placeholder="Cole aqui exemplos de perguntas que gostaria de incluir..."
                      rows={3}
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Nº de perguntas</label>
                      <select 
                        value={formData.questionCount}
                        onChange={(e) => setFormData({ ...formData, questionCount: parseInt(e.target.value) })}
                      >
                        <option value={15}>15 perguntas</option>
                        <option value={20}>20 perguntas</option>
                        <option value={25}>25 perguntas</option>
                        <option value={30}>30 perguntas</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Nº de dimensões</label>
                      <select 
                        value={formData.dimensionCount}
                        onChange={(e) => setFormData({ ...formData, dimensionCount: parseInt(e.target.value) })}
                      >
                        <option value={4}>4 dimensões</option>
                        <option value={5}>5 dimensões</option>
                        <option value={6}>6 dimensões</option>
                        <option value={8}>8 dimensões</option>
                      </select>
                    </div>
                  </div>

                  <div className="btn-group">
                    <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                      Cancelar
                    </button>
                    <button 
                      className="btn-primary" 
                      onClick={handleGenerateAI}
                      disabled={generating || !formData.name || !formData.objective}
                    >
                      {generating ? '🤖 Gerando...' : '🤖 Gerar com IA'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Descrição</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Descrição do diagnóstico..."
                      rows={3}
                    />
                  </div>

                  <div className="btn-group">
                    <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                      Cancelar
                    </button>
                    <button 
                      className="btn-primary" 
                      onClick={handleCreateManual}
                      disabled={!formData.name}
                    >
                      Criar Diagnóstico
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Editar */}
      <AnimatePresence>
        {showEditModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowEditModal(false)}
          >
            <motion.div 
              className="modal modal-lg"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>
                {editingItem?.type === 'diagnostic' ? 'Editar Diagnóstico' :
                 editingItem?.type === 'dimension' ? 'Editar Dimensão' : 
                 editingItem?.type === 'new-question' ? 'Nova Pergunta' : 'Editar Pergunta'}
              </h2>
              
              {editingItem?.type === 'diagnostic' ? (
                <>
                  <div className="form-group">
                    <label>Nome do diagnóstico</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Descrição</label>
                    <textarea
                      value={editForm.description || ''}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={3}
                      placeholder="Descrição do diagnóstico..."
                    />
                  </div>
                  <div className="form-group checkbox-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={editForm.is_nr1 || false}
                        onChange={(e) => setEditForm({ ...editForm, is_nr1: e.target.checked })}
                      />
                      <span>📋 Diagnóstico relacionado à NR-1</span>
                    </label>
                    <small className="form-hint">Marque se este diagnóstico será usado para conformidade com a NR-1</small>
                  </div>
                </>
              ) : editingItem?.type === 'dimension' ? (
                <div className="form-group">
                  <label>Nome da dimensão</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label>Texto da pergunta</label>
                    <textarea
                      value={editForm.text}
                      onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
                      rows={3}
                      placeholder="Digite a pergunta..."
                    />
                  </div>

                  <div className="form-group">
                    <label>Tipo de pergunta</label>
                    <select
                      value={editForm.type}
                      onChange={(e) => setEditForm({ ...editForm, type: e.target.value, options: [] })}
                    >
                      <option value="likert5">Escala Likert 1-5 (Concordo/Discordo)</option>
                      <option value="likert10">Escala 0-10</option>
                      <option value="nps">eNPS (Employee Net Promoter Score)</option>
                      <option value="yes_no">Sim / Não</option>
                      <option value="single_choice">Escolha única (opções customizadas)</option>
                      <option value="multiple_choice">Múltipla escolha</option>
                      <option value="open">Resposta aberta (texto)</option>
                    </select>
                  </div>

                  {['single_choice', 'multiple_choice'].includes(editForm.type) && (
                    <div className="form-group">
                      <label>Opções (uma por linha)</label>
                      <textarea
                        value={(editForm.options || []).join('\n')}
                        onChange={(e) => setEditForm({ 
                          ...editForm, 
                          options: e.target.value.split('\n').filter(o => o.trim())
                        })}
                        rows={5}
                        placeholder="Opção 1&#10;Opção 2&#10;Opção 3"
                      />
                    </div>
                  )}

                  {['likert5', 'likert10', 'nps'].includes(editForm.type) && (
                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={editForm.inverted}
                          onChange={(e) => setEditForm({ ...editForm, inverted: e.target.checked })}
                        />
                        Pergunta invertida (concordar indica algo negativo)
                      </label>
                    </div>
                  )}

                  {['single_choice', 'multiple_choice'].includes(editForm.type) && (
                    <div className="form-group">
                      <label className="checkbox-label demographic-checkbox">
                        <input
                          type="checkbox"
                          checked={editForm.is_demographic}
                          onChange={(e) => setEditForm({ ...editForm, is_demographic: e.target.checked })}
                        />
                        <span>
                          📊 Pergunta demográfica (usar como filtro no Dashboard)
                          <small>Ex: Cargo, Sexo, Unidade, Faixa Etária</small>
                        </span>
                      </label>
                    </div>
                  )}
                </>
              )}

              <div className="btn-group">
                <button className="btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancelar
                </button>
                <button 
                  className="btn-primary" 
                  onClick={editingItem?.type === 'new-question' ? handleSaveNewQuestion : handleSaveEdit}
                >
                  {editingItem?.type === 'new-question' ? 'Adicionar' : 'Salvar'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Colaborador */}
      <AnimatePresence>
        {showCollabModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCollabModal(false)}
          >
            <motion.div 
              className="modal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>{editingCollab ? 'Editar Colaborador' : 'Novo Colaborador'}</h2>
              
              <form onSubmit={handleCollabSubmit}>
                <div className="form-group">
                  <label>Nome completo *</label>
                  <input
                    type="text"
                    value={collabForm.name}
                    onChange={(e) => setCollabForm({ ...collabForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>E-mail *</label>
                  <input
                    type="email"
                    value={collabForm.email}
                    onChange={(e) => setCollabForm({ ...collabForm, email: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Departamento</label>
                  <select
                    value={collabForm.department_id}
                    onChange={(e) => setCollabForm({ ...collabForm, department_id: e.target.value })}
                  >
                    <option value="">Selecione...</option>
                    {diagDepartments.map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                  {diagDepartments.length === 0 && (
                    <small className="form-hint">Adicione departamentos primeiro na aba "Departamentos"</small>
                  )}
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowCollabModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={collabSubmitting}>
                    {collabSubmitting ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {/* Batch Create Modal */}
        {showBatchModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowBatchModal(false)}
          >
            <motion.div 
              className="modal"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>📋 Adicionar em Lote</h2>
              
              <form onSubmit={handleBatchSubmit}>
                <div className="form-group">
                  <label>Quantidade de colaboradores *</label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={batchForm.quantity}
                    onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Prefixo do nome *</label>
                  <input
                    type="text"
                    value={batchForm.prefix}
                    onChange={(e) => setBatchForm({ ...batchForm, prefix: e.target.value })}
                    placeholder="colaborador"
                    required
                  />
                  <small className="form-hint">Ex: "colaborador" → colaborador 1, colaborador 2...</small>
                </div>

                <div className="form-group">
                  <label>Domínio do e-mail *</label>
                  <input
                    type="text"
                    value={batchForm.domain}
                    onChange={(e) => setBatchForm({ ...batchForm, domain: e.target.value })}
                    placeholder="empresa.com.br"
                    required
                  />
                  <small className="form-hint">Ex: "empresa.com.br" → colaborador1@empresa.com.br</small>
                </div>

                <div className="form-group">
                  <label>Senha (mesma para todos) *</label>
                  <input
                    type="text"
                    value={batchForm.password}
                    onChange={(e) => setBatchForm({ ...batchForm, password: e.target.value })}
                    placeholder="senha123"
                    required
                  />
                </div>

                {diagDepartments.length === 0 && (
                  <div className="warning-box">
                    ⚠️ Cadastre pelo menos 1 departamento antes de adicionar em lote.
                  </div>
                )}

                {diagDepartments.length > 0 && (
                  <div className="info-box">
                    ℹ️ Os {batchForm.quantity} colaboradores serão distribuídos entre os {diagDepartments.length} departamento(s).
                  </div>
                )}

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowBatchModal(false)}>
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary" 
                    disabled={batchSubmitting || diagDepartments.length === 0}
                  >
                    {batchSubmitting ? 'Criando...' : `Criar ${batchForm.quantity} Colaboradores`}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ==========================================
// ADMIN LAYOUT
// ==========================================

const AdminLayout = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [departments, setDepartments] = useState([]);
  const [diagnostics, setDiagnostics] = useState([]);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [diagnosticFilter, setDiagnosticFilter] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadDiagnostics();
  }, []);

  // Load departments when diagnostic changes
  useEffect(() => {
    if (diagnosticFilter) {
      loadDepartmentsForDiagnostic(diagnosticFilter);
    } else {
      setDepartments([]);
    }
    // Reset department filter when diagnostic changes
    setDepartmentFilter('');
  }, [diagnosticFilter]);

  const loadDepartmentsForDiagnostic = async (diagId) => {
    try {
      const data = await diagnosticsApi.getDepartments(diagId);
      setDepartments(data);
    } catch (err) {
      console.error('Erro ao carregar departamentos:', err);
      setDepartments([]);
    }
  };

  // Generic loadDepartments (loads for current diagnostic filter)
  const loadDepartments = async () => {
    if (diagnosticFilter) {
      await loadDepartmentsForDiagnostic(diagnosticFilter);
    }
  };

  const loadDiagnostics = async () => {
    try {
      const data = await diagnosticsApi.getAll();
      setDiagnostics(data);
      // Auto-select first active diagnostic with responses
      const firstWithResponses = data.find(d => d.response_count > 0);
      if (firstWithResponses) {
        setDiagnosticFilter(firstWithResponses.id);
      }
    } catch (err) {
      console.error('Erro ao carregar diagnósticos:', err);
    }
  };

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard 
          departmentFilter={departmentFilter} 
          setDepartmentFilter={setDepartmentFilter} 
          departments={departments}
          diagnostics={diagnostics}
          diagnosticFilter={diagnosticFilter}
          setDiagnosticFilter={setDiagnosticFilter}
        />;
      case 'diagnostics':
        return <DiagnosticsManagement showToast={showToast} onDiagnosticsChange={loadDiagnostics} user={user} departments={departments} loadDepartments={loadDepartments} />;
      case 'settings':
        return <Settings showToast={showToast} user={user} />;
      default:
        return <Dashboard 
          departmentFilter={departmentFilter} 
          setDepartmentFilter={setDepartmentFilter} 
          departments={departments}
          diagnostics={diagnostics}
          diagnosticFilter={diagnosticFilter}
          setDiagnosticFilter={setDiagnosticFilter}
        />;
    }
  };

  return (
    <div className="admin-layout">
      <header className="header">
        <div className="header-left">
          <Logo size="small" />
          <div className="header-brand">
            <span className="header-title">Pesquisa Cuidar+ Inspira NR1</span>
            <span className="header-slogan">Performance com bem-estar</span>
          </div>
        </div>
        <div className="header-right">
          <div className="user-info">
            <span className="user-name">{user.name}</span>
            <span className="user-role">{user.role === 'admin' ? 'Administrador' : 'RH'}</span>
          </div>
          <button className="btn-logout" onClick={onLogout}>
            Sair
          </button>
        </div>
      </header>

      <div className="admin-content">
        <nav className="sidebar">
          <button 
            className={`sidebar-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            📊 Dashboard
          </button>
          {user.role === 'admin' && (
            <button 
              className={`sidebar-item ${activeTab === 'diagnostics' ? 'active' : ''}`}
              onClick={() => setActiveTab('diagnostics')}
            >
              🧠 Diagnósticos
            </button>
          )}
          {user.role === 'admin' && (
            <button 
              className={`sidebar-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              ⚙️ Configurações
            </button>
          )}
        </nav>

        <main className="main-content">
          {renderContent()}
        </main>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <Toast 
            message={toast.message} 
            type={toast.type} 
            onClose={() => setToast(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ==========================================
// MAIN APP
// ==========================================

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const validateSession = async () => {
      const storedUser = getStoredUser();
      if (storedUser) {
        try {
          // Validate token by calling the API
          const response = await authApi.getMe();
          setUser(response.user);
        } catch (err) {
          // Token is invalid or expired - clear and show login
          clearAuth();
          setUser(null);
        }
      }
      setLoading(false);
    };
    
    validateSession();
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    authApi.logout();
    setUser(null);
  };

  if (loading) return <Loading />;

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // User or Demo role - show survey
  if (user.role === 'user' || user.role === 'demo') {
    return <UserSurvey user={user} onComplete={() => {}} />;
  }

  // Admin/RH - show dashboard
  return <AdminLayout user={user} onLogout={handleLogout} />;
}
