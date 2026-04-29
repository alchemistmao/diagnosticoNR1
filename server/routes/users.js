import express from 'express';
import bcrypt from 'bcryptjs';
import { dbGet, dbAll, dbRun, dbQuery } from '../database.js';
import { authenticate, isAdmin, isAdminOrRH } from '../auth.js';
import { sendWelcomeEmail } from '../email.js';

const router = express.Router();

function generatePassword(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

router.get('/', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.email, u.name, u.role, u.department_id, u.diagnostic_id, u.created_at, 
             d.name as department_name,
             diag.name as diagnostic_name
      FROM users u 
      LEFT JOIN departments d ON u.department_id = d.id 
      LEFT JOIN diagnostics diag ON u.diagnostic_id = diag.id
      ORDER BY u.created_at DESC
    `);
    res.json(users);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.get('/collaborators', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { diagnostic_id } = req.query;
    
    let query = `
      SELECT u.id, u.email, u.name, u.role, u.department_id, u.diagnostic_id, u.created_at, 
             d.name as department_name,
             diag.name as diagnostic_name,
             CASE WHEN r.id IS NOT NULL THEN true ELSE false END as has_responded
      FROM users u 
      LEFT JOIN departments d ON u.department_id = d.id 
      LEFT JOIN diagnostics diag ON u.diagnostic_id = diag.id
      LEFT JOIN responses r ON u.id = r.user_id AND r.diagnostic_id = u.diagnostic_id
      WHERE u.role = 'user'
    `;
    
    const params = [];
    if (diagnostic_id) {
      params.push(diagnostic_id);
      query += ` AND u.diagnostic_id = $${params.length}`;
    }
    
    query += ` GROUP BY u.id, d.name, diag.name, r.id ORDER BY u.created_at DESC`;
    
    const users = await dbAll(query, params);
    res.json(users);
  } catch (error) {
    console.error('Erro ao buscar colaboradores:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.get('/admins', authenticate, isAdmin, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT id, email, name, role, created_at 
      FROM users 
      WHERE role IN ('admin', 'rh') 
      ORDER BY created_at DESC
    `);
    res.json(users);
  } catch (error) {
    console.error('Erro ao buscar admins:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.post('/', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { email, name, role, department_id, diagnostic_id } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: 'E-mail e nome são obrigatórios' });
    }

    const userRole = role || 'user';
    if ((userRole === 'admin' || userRole === 'rh') && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem criar usuários admin/RH' });
    }

    // Collaborators (role = 'user') must have a diagnostic_id
    if (userRole === 'user' && !diagnostic_id) {
      return res.status(400).json({ error: 'Colaboradores devem estar associados a um diagnóstico' });
    }

    const existing = await dbGet('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    const tempPassword = generatePassword(10);
    const hashedPassword = bcrypt.hashSync(tempPassword, 10);

    const result = await dbQuery(
      'INSERT INTO users (email, password, name, role, department_id, diagnostic_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [email.toLowerCase(), hashedPassword, name, userRole, department_id || null, userRole === 'user' ? diagnostic_id : null]
    );

    const userId = result.rows[0].id;

    // Auto-enroll collaborator in their diagnostic
    if (userRole === 'user' && diagnostic_id) {
      await dbQuery(
        'INSERT INTO user_diagnostics (user_id, diagnostic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, diagnostic_id]
      );
    }

    const newUser = await dbGet('SELECT id, email, name, role, department_id, diagnostic_id FROM users WHERE id = $1', [userId]);
    const emailResult = await sendWelcomeEmail(newUser, tempPassword);

    res.status(201).json({
      user: newUser,
      emailSent: emailResult.success,
      emailSimulated: emailResult.simulated || false,
      tempPassword: emailResult.simulated ? tempPassword : undefined
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

// Batch create collaborators
router.post('/batch', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { quantity, prefix, domain, password, diagnostic_id } = req.body;
    
    if (!quantity || !prefix || !domain || !password || !diagnostic_id) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    if (quantity < 1 || quantity > 500) {
      return res.status(400).json({ error: 'Quantidade deve ser entre 1 e 500' });
    }
    
    // Get departments for this diagnostic
    const departments = await dbAll(
      'SELECT id FROM departments WHERE diagnostic_id = $1 ORDER BY id',
      [diagnostic_id]
    );
    
    if (departments.length === 0) {
      return res.status(400).json({ error: 'É necessário ter pelo menos 1 departamento cadastrado' });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    let created = 0;
    let skipped = 0;
    
    for (let i = 1; i <= quantity; i++) {
      const name = `${prefix} ${i}`;
      const email = `${prefix.toLowerCase().replace(/\s/g, '')}${i}@${domain}`.toLowerCase();
      
      // Check if email already exists
      const existing = await dbGet('SELECT id FROM users WHERE email = $1', [email]);
      if (existing) {
        skipped++;
        continue;
      }
      
      // Round-robin department assignment
      const deptIndex = (i - 1) % departments.length;
      const departmentId = departments[deptIndex].id;
      
      // Create user
      const result = await dbQuery(
        'INSERT INTO users (email, password, name, role, department_id, diagnostic_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [email, hashedPassword, name, 'user', departmentId, diagnostic_id]
      );
      
      const userId = result.rows[0].id;
      
      // Auto-enroll in diagnostic
      await dbQuery(
        'INSERT INTO user_diagnostics (user_id, diagnostic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, diagnostic_id]
      );
      
      created++;
    }
    
    res.status(201).json({ 
      created, 
      skipped,
      message: `${created} colaboradores criados${skipped > 0 ? `, ${skipped} ignorados (e-mail já existe)` : ''}`
    });
  } catch (error) {
    console.error('Erro ao criar usuários em lote:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.put('/:id', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, department_id } = req.body;

    const user = await dbGet('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if ((user.role === 'admin' || user.role === 'rh') && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem editar usuários admin/RH' });
    }

    if (email && email.toLowerCase() !== user.email) {
      const existing = await dbGet('SELECT id FROM users WHERE email = $1 AND id != $2', [email.toLowerCase(), id]);
      if (existing) {
        return res.status(400).json({ error: 'E-mail já cadastrado por outro usuário' });
      }
    }

    await dbRun(
      'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), role = COALESCE($3, role), department_id = $4 WHERE id = $5',
      [name, email?.toLowerCase(), role, department_id, id]
    );

    const updated = await dbGet('SELECT id, email, name, role, department_id FROM users WHERE id = $1', [id]);
    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.delete('/:id', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await dbGet('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Você não pode excluir a si mesmo' });
    }
    if ((user.role === 'admin' || user.role === 'rh') && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem excluir usuários admin/RH' });
    }
    if (user.role === 'admin') {
      const adminCount = await dbGet("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
      if (parseInt(adminCount.count) <= 1) {
        return res.status(400).json({ error: 'Não é possível excluir o único administrador' });
      }
    }

    // Delete all user-related data
    await dbRun('DELETE FROM responses WHERE user_id = $1', [id]);
    await dbRun('DELETE FROM user_diagnostics WHERE user_id = $1', [id]);
    await dbRun('DELETE FROM password_reset_tokens WHERE user_id = $1', [id]);
    await dbRun('DELETE FROM users WHERE id = $1', [id]);

    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir usuário:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.post('/:id/resend-email', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await dbGet('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const tempPassword = generatePassword(10);
    const hashedPassword = bcrypt.hashSync(tempPassword, 10);
    await dbRun('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, id]);

    const emailResult = await sendWelcomeEmail(user, tempPassword);
    res.json({
      success: emailResult.success,
      emailSimulated: emailResult.simulated || false,
      tempPassword: emailResult.simulated ? tempPassword : undefined
    });
  } catch (error) {
    console.error('Erro ao reenviar email:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

export default router;
