import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { dbGet, dbRun } from '../database.js';
import { generateToken, authenticate } from '../auth.js';
import { sendPasswordResetEmail } from '../email.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, department_id: user.department_id }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Senhas são obrigatórias' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Nova senha deve ter no mínimo 6 caracteres' });
    }

    const user = await dbGet('SELECT password FROM users WHERE id = $1', [req.user.id]);
    if (!bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(400).json({ error: 'Senha atual incorreta' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await dbRun('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);
    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    const user = await dbGet('SELECT id, email, name FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) {
      return res.json({ message: 'Se o e-mail existir, você receberá as instruções.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    await dbRun(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, resetToken, expiresAt]
    );

    await sendPasswordResetEmail(user, resetToken);
    res.json({ message: 'Se o e-mail existir, você receberá as instruções.' });
  } catch (error) {
    console.error('Erro ao solicitar reset:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    const resetToken = await dbGet(
      "SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > NOW()",
      [token]
    );
    if (!resetToken) {
      return res.status(400).json({ error: 'Token inválido ou expirado' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await dbRun('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, resetToken.user_id]);
    await dbRun('UPDATE password_reset_tokens SET used = true WHERE id = $1', [resetToken.id]);

    res.json({ message: 'Senha redefinida com sucesso' });
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    res.status(500).json({ error: `Erro: ${error.message}`, code: 'SERVER_ERROR' });
  }
});

export default router;
