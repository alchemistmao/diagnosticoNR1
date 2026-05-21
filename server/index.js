import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { initDatabase } from './database.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import departmentsRoutes from './routes/departments.js';
import responsesRoutes from './routes/responses.js';
import diagnosticsRoutes from './routes/diagnostics.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Railway, Heroku, etc)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde alguns minutos.' }
});
app.use('/api/', limiter);

// CORS
app.use(cors());

// Body parsing - increased limit for document import
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/responses', responsesRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'postgresql' });
});

// Serve static files in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Algo deu errado no servidor' });
});

// Initialize database then start server
initDatabase().then(() => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🐘 Conectado ao PostgreSQL`);
  });

  // Timeout de 30s por request — evita conexões penduradas
  server.setTimeout(30000);

  // Graceful shutdown ao receber SIGTERM (Railway, deploys, etc)
  process.on('SIGTERM', () => {
    console.log('SIGTERM recebido — encerrando servidor...');
    server.close(() => {
      console.log('Servidor encerrado com sucesso.');
      process.exit(0);
    });
    // Força saída após 10s se ainda houver conexões abertas
    setTimeout(() => {
      console.warn('Timeout no shutdown — forçando saída.');
      process.exit(1);
    }, 10000);
  });
}).catch(err => {
  console.error('Erro ao inicializar banco:', err);
  process.exit(1);
});
