import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

// Railway provides DATABASE_URL automatically when you add PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Diagnóstico NR-1 original para migração
const NR1_DIAGNOSTIC = {
  name: 'Diagnóstico Psicossocial NR-1',
  description: 'Avaliação de riscos psicossociais conforme NR-1, analisando fatores como carga de trabalho, liderança, relações interpessoais e saúde mental.',
  dimensions: [
    {
      name: 'Organização e Carga de Trabalho',
      questions: [
        { text: 'Consigo realizar minhas tarefas dentro do horário de trabalho.', inverted: false },
        { text: 'Frequentemente preciso trabalhar em ritmo acelerado para dar conta das demandas.', inverted: true },
        { text: 'Tenho autonomia para decidir como realizar minhas atividades.', inverted: false },
        { text: 'O volume de trabalho é compatível com minha jornada.', inverted: false },
      ]
    },
    {
      name: 'Clareza de Papéis',
      questions: [
        { text: 'Sei exatamente o que é esperado de mim no trabalho.', inverted: false },
        { text: 'Minhas responsabilidades são bem definidas.', inverted: false },
        { text: 'Recebo informações claras sobre mudanças que afetam meu trabalho.', inverted: false },
        { text: 'Entendo como meu trabalho contribui para os objetivos da empresa.', inverted: false },
      ]
    },
    {
      name: 'Liderança e Suporte',
      questions: [
        { text: 'Meu gestor me trata com respeito.', inverted: false },
        { text: 'Posso contar com apoio do meu gestor quando preciso.', inverted: false },
        { text: 'Recebo feedback construtivo sobre meu desempenho.', inverted: false },
      ]
    },
    {
      name: 'Relações Interpessoais',
      questions: [
        { text: 'Existe colaboração entre os colegas da minha equipe.', inverted: false },
        { text: 'O ambiente de trabalho é respeitoso e livre de conflitos frequentes.', inverted: false },
        { text: 'Sinto que faço parte de um time.', inverted: false },
      ]
    },
    {
      name: 'Segurança Psicológica',
      questions: [
        { text: 'Me sinto seguro para expressar opiniões no trabalho.', inverted: false },
        { text: 'Posso cometer erros sem medo de punição desproporcional.', inverted: false },
        { text: 'Sinto que posso ser eu mesmo no ambiente de trabalho.', inverted: false },
      ]
    },
    {
      name: 'Reconhecimento e Justiça',
      questions: [
        { text: 'Sinto que meu trabalho é reconhecido.', inverted: false },
        { text: 'As decisões que me afetam são tomadas de forma justa.', inverted: false },
        { text: 'Tenho oportunidades de crescimento na empresa.', inverted: false },
      ]
    },
    {
      name: 'Saúde Mental',
      questions: [
        { text: 'Tenho me sentido ansioso ou preocupado com frequência por causa do trabalho.', inverted: true },
        { text: 'Tenho tido dificuldade para dormir por questões relacionadas ao trabalho.', inverted: true },
        { text: 'Me sinto emocionalmente esgotado ao final do dia de trabalho.', inverted: true },
      ]
    },
    {
      name: 'Apoio Organizacional',
      questions: [
        { text: 'A empresa demonstra preocupação genuína com o bem-estar dos colaboradores.', inverted: false },
        { text: 'Tenho acesso a recursos ou programas de apoio à saúde mental.', inverted: false },
        { text: 'Confio que a empresa tomará medidas se eu reportar um problema.', inverted: false },
      ]
    },
  ]
};

export async function initDatabase() {
  const client = await pool.connect();
  
  try {
    // Create departments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        diagnostic_id INTEGER REFERENCES diagnostics(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add diagnostic_id to departments if not exists
    const deptDiagCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'departments' AND column_name = 'diagnostic_id'
    `);
    if (deptDiagCheck.rows.length === 0) {
      await client.query('ALTER TABLE departments ADD COLUMN diagnostic_id INTEGER REFERENCES diagnostics(id) ON DELETE CASCADE');
    }

    // Fix departments constraint: change from UNIQUE(name) to UNIQUE(diagnostic_id, name)
    // This allows same department name in different diagnostics
    const oldConstraint = await client.query(`
      SELECT constraint_name FROM information_schema.table_constraints 
      WHERE table_name = 'departments' AND constraint_name = 'departments_name_key'
    `);
    if (oldConstraint.rows.length > 0) {
      console.log('[DB] Removing old departments_name_key constraint...');
      await client.query('ALTER TABLE departments DROP CONSTRAINT departments_name_key');
    }
    
    // Add new composite unique constraint if not exists
    const newConstraint = await client.query(`
      SELECT constraint_name FROM information_schema.table_constraints 
      WHERE table_name = 'departments' AND constraint_name = 'departments_diagnostic_name_unique'
    `);
    if (newConstraint.rows.length === 0) {
      console.log('[DB] Adding new departments_diagnostic_name_unique constraint...');
      await client.query('ALTER TABLE departments ADD CONSTRAINT departments_diagnostic_name_unique UNIQUE (diagnostic_id, name)');
    }

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK(role IN ('admin', 'rh', 'user', 'demo')),
        department_id INTEGER REFERENCES departments(id),
        email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create diagnostics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS diagnostics (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'draft')),
        is_nr1 BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create dimensions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS dimensions (
        id SERIAL PRIMARY KEY,
        diagnostic_id INTEGER NOT NULL REFERENCES diagnostics(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create questions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        dimension_id INTEGER NOT NULL REFERENCES dimensions(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'likert5',
        options JSONB,
        inverted BOOLEAN DEFAULT FALSE,
        required BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add type and options columns if not exist
    const typeCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'questions' AND column_name = 'type'
    `);
    if (typeCheck.rows.length === 0) {
      await client.query("ALTER TABLE questions ADD COLUMN type VARCHAR(50) DEFAULT 'likert5'");
      await client.query("ALTER TABLE questions ADD COLUMN options JSONB");
      await client.query("ALTER TABLE questions ADD COLUMN required BOOLEAN DEFAULT TRUE");
    }

    // Add is_demographic column if not exist
    const isDemoColCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'questions' AND column_name = 'is_demographic'
    `);
    if (isDemoColCheck.rows.length === 0) {
      await client.query("ALTER TABLE questions ADD COLUMN is_demographic BOOLEAN DEFAULT FALSE");
      console.log('[DB] Coluna is_demographic adicionada à tabela questions');
    }

    // Add is_nr1 column to diagnostics if not exist
    const isNr1Check = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'diagnostics' AND column_name = 'is_nr1'
    `);
    if (isNr1Check.rows.length === 0) {
      await client.query("ALTER TABLE diagnostics ADD COLUMN is_nr1 BOOLEAN DEFAULT FALSE");
      console.log('[DB] Coluna is_nr1 adicionada à tabela diagnostics');
    }

    // Add diagnostic_id column to users table (for associating collaborators to a diagnostic)
    const userDiagIdCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'diagnostic_id'
    `);
    if (userDiagIdCheck.rows.length === 0) {
      await client.query("ALTER TABLE users ADD COLUMN diagnostic_id INTEGER REFERENCES diagnostics(id) ON DELETE SET NULL");
      console.log('[DB] Coluna diagnostic_id adicionada à tabela users');
    }

    // Update role constraint to include 'demo'
    try {
      await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
      await client.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin', 'rh', 'user', 'demo'))");
      console.log('[DB] Constraint users_role_check atualizado para incluir demo');
    } catch (e) {
      // Constraint might already be correct
    }

    // Add diagnostic_id to responses (if not exists)
    const columnCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'responses' AND column_name = 'diagnostic_id'
    `);
    
    if (columnCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE responses ADD COLUMN diagnostic_id INTEGER REFERENCES diagnostics(id)
      `);
    }

    // Create responses table (if not exists)
    await client.query(`
      CREATE TABLE IF NOT EXISTS responses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        department_id INTEGER NOT NULL REFERENCES departments(id),
        diagnostic_id INTEGER REFERENCES diagnostics(id),
        answers JSONB NOT NULL,
        open_answers JSONB,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create password_reset_tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_diagnostics table (enrollment)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_diagnostics (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        diagnostic_id INTEGER NOT NULL REFERENCES diagnostics(id) ON DELETE CASCADE,
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, diagnostic_id)
      )
    `);

    // Create user_diagnostics_access table (RH access control)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_diagnostics_access (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        diagnostic_id INTEGER NOT NULL REFERENCES diagnostics(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, diagnostic_id)
      )
    `);

    // Create default admin if not exists
    const adminCheck = await client.query(
      "SELECT id FROM users WHERE email = 'admin@cuidarmais.com.br'"
    );

    if (adminCheck.rows.length === 0) {
      const hashedPassword = bcrypt.hashSync('cuidarmais', 10);

      await client.query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
        ['admin@cuidarmais.com.br', hashedPassword, 'Administrador', 'admin']
      );

      await client.query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
        ['rh@cuidarmais.com.br', hashedPassword, 'Recursos Humanos', 'rh']
      );

      console.log('✅ Usuários padrão criados (admin e rh)');
    }

    // Create demo user if not exists
    const demoCheck = await client.query(
      "SELECT id FROM users WHERE email = 'demo@cuidarmais.com.br'"
    );

    if (demoCheck.rows.length === 0) {
      const demoPassword = bcrypt.hashSync('demo123', 10);
      await client.query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
        ['demo@cuidarmais.com.br', demoPassword, 'Usuário Demo', 'demo']
      );
      console.log('✅ Usuário demo criado (demo@cuidarmais.com.br / demo123)');
    }

    // Migrate NR-1 diagnostic if not exists
    const diagnosticCheck = await client.query(
      "SELECT id FROM diagnostics WHERE name = $1",
      [NR1_DIAGNOSTIC.name]
    );

    if (diagnosticCheck.rows.length === 0) {
      // Create diagnostic
      const diagResult = await client.query(
        'INSERT INTO diagnostics (name, description, status) VALUES ($1, $2, $3) RETURNING id',
        [NR1_DIAGNOSTIC.name, NR1_DIAGNOSTIC.description, 'active']
      );
      const diagnosticId = diagResult.rows[0].id;

      // Create dimensions and questions
      let dimOrder = 0;
      for (const dim of NR1_DIAGNOSTIC.dimensions) {
        const dimResult = await client.query(
          'INSERT INTO dimensions (diagnostic_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
          [diagnosticId, dim.name, dimOrder++]
        );
        const dimensionId = dimResult.rows[0].id;

        let qOrder = 0;
        for (const q of dim.questions) {
          await client.query(
            'INSERT INTO questions (dimension_id, text, inverted, sort_order) VALUES ($1, $2, $3, $4)',
            [dimensionId, q.text, q.inverted, qOrder++]
          );
        }
      }

      // Update existing responses to link to this diagnostic
      await client.query(
        'UPDATE responses SET diagnostic_id = $1 WHERE diagnostic_id IS NULL',
        [diagnosticId]
      );

      console.log('✅ Diagnóstico NR-1 migrado para o banco de dados');
    }

    console.log('✅ Banco de dados PostgreSQL inicializado');
  } finally {
    client.release();
  }
}

// Query helper functions
export async function dbQuery(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

export async function dbGet(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

export async function dbAll(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function dbRun(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

export { pool };
export default { initDatabase, dbQuery, dbGet, dbAll, dbRun, pool };
