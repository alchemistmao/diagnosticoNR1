import jwt from 'jsonwebtoken';
import { dbGet } from './database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'cuidarmais-secret-key-change-in-production';

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  try {
    const user = await dbGet(
      'SELECT id, email, name, role, department_id FROM users WHERE id = $1',
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Erro na autenticação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export function isAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }
  next();
}

export function isAdminOrRH(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'rh') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores ou RH.' });
  }
  next();
}

export { JWT_SECRET };
