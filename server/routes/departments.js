import express from 'express';
import { dbGet, dbAll, dbRun, dbQuery } from '../database.js';
import { authenticate, isAdminOrRH } from '../auth.js';

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const departments = await dbAll(`
      SELECT d.*, 
             COUNT(DISTINCT CASE WHEN u.role = 'user' THEN u.id END) as user_count, 
             COUNT(DISTINCT r.id) as response_count 
      FROM departments d 
      LEFT JOIN users u ON d.id = u.department_id 
      LEFT JOIN responses r ON d.id = r.department_id 
      GROUP BY d.id 
      ORDER BY d.name
    `);
    res.json(departments);
  } catch (error) {
    console.error('Erro ao buscar departamentos:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const department = await dbGet(`
      SELECT d.*, 
             COUNT(DISTINCT CASE WHEN u.role = 'user' THEN u.id END) as user_count, 
             COUNT(DISTINCT r.id) as response_count 
      FROM departments d 
      LEFT JOIN users u ON d.id = u.department_id 
      LEFT JOIN responses r ON d.id = r.department_id 
      WHERE d.id = $1 
      GROUP BY d.id
    `, [id]);
    if (!department) {
      return res.status(404).json({ error: 'Departamento não encontrado' });
    }
    res.json(department);
  } catch (error) {
    console.error('Erro ao buscar departamento:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.post('/', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const existing = await dbGet('SELECT id FROM departments WHERE name = $1', [name]);
    if (existing) {
      return res.status(400).json({ error: 'Já existe um departamento com este nome' });
    }

    const result = await dbQuery(
      'INSERT INTO departments (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar departamento:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.put('/:id', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const department = await dbGet('SELECT * FROM departments WHERE id = $1', [id]);
    if (!department) {
      return res.status(404).json({ error: 'Departamento não encontrado' });
    }

    if (name && name !== department.name) {
      const existing = await dbGet('SELECT id FROM departments WHERE name = $1 AND id != $2', [name, id]);
      if (existing) {
        return res.status(400).json({ error: 'Já existe um departamento com este nome' });
      }
    }

    await dbRun(
      'UPDATE departments SET name = COALESCE($1, name), description = $2 WHERE id = $3',
      [name, description, id]
    );
    const updated = await dbGet('SELECT * FROM departments WHERE id = $1', [id]);
    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar departamento:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.delete('/:id', authenticate, isAdminOrRH, async (req, res) => {
  try {
    const { id } = req.params;
    const department = await dbGet('SELECT * FROM departments WHERE id = $1', [id]);
    if (!department) {
      return res.status(404).json({ error: 'Departamento não encontrado' });
    }

    const userCount = await dbGet('SELECT COUNT(*) as count FROM users WHERE department_id = $1', [id]);
    if (parseInt(userCount.count) > 0) {
      return res.status(400).json({ error: `Não é possível excluir. Existem ${userCount.count} colaborador(es) neste departamento.` });
    }

    await dbRun('DELETE FROM responses WHERE department_id = $1', [id]);
    await dbRun('DELETE FROM departments WHERE id = $1', [id]);
    res.json({ message: 'Departamento excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir departamento:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

export default router;
