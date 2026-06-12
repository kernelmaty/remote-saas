import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/db.js';

const REFRESH_DAYS = Number(process.env.REFRESH_TTL_DAYS || 7);

const registerSchema = z.object({
    companyName: z.string().min(2),
    fullName:    z.string().min(2),
    email:       z.string().email(),
    password:    z.string().min(8),
});

function signAccess(user) {
    return jwt.sign(
      { sub: user.id, cid: user.company_id, role: user.role },
          process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_TTL || '15m' }
        );
}

function hashToken(t) {
    return crypto.createHash('sha256').update(t).digest('hex');
}

/**
 * Emite un refresh token usando el cliente de BD proporcionado
 * (para ejecutarse dentro de una transacción existente).
 */
async function issueRefreshWithClient(client, userId, family = crypto.randomUUID()) {
    const raw = crypto.randomBytes(48).toString('base64url');
    await client.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at)
               VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
          [userId, hashToken(raw), family, REFRESH_DAYS]
        );
    return raw;
}

/**
 * Emite un refresh token usando el pool global (fuera de transacción).
 */
async function issueRefresh(userId, family = crypto.randomUUID()) {
    const raw = crypto.randomBytes(48).toString('base64url');
    await pool.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at)
               VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
          [userId, hashToken(raw), family, REFRESH_DAYS]
        );
    return raw;
}

export async function register(req, res) {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { companyName, fullName, email, password } = parsed.data;

  const client = await pool.connect();
    try {
          await client.query('BEGIN');
          const { rows: [company] } = await client.query(
                  'INSERT INTO companies (name) VALUES ($1) RETURNING id, name, plan', [companyName]);
          const passwordHash = await bcrypt.hash(password, 12);
          const { rows: [user] } = await client.query(
                  `INSERT INTO users (company_id, email, password_hash, full_name, role)
                         VALUES ($1, $2, $3, $4, 'admin') RETURNING id, company_id, email, full_name, role`,
                  [company.id, email.toLowerCase(), passwordHash, fullName]);
          // Emitir el refresh token DENTRO de la misma transacción para atomicidad
      const refresh = await issueRefreshWithClient(client, user.id);
          await client.query('COMMIT');
          res.status(201).json({ company, user, accessToken: signAccess(user), refreshToken: refresh });
    } catch (err) {
          await client.query('ROLLBACK');
          if (err.code === '23505') return res.status(409).json({ error: 'El email ya está registrado' });
          throw err;
    } finally {
          client.release();
    }
}

export async function login(req, res) {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });

  const { rows: [user] } = await pool.query(
        'SELECT * FROM users WHERE email = $1 AND is_active', [String(email).toLowerCase()]);
    // Comparación siempre ejecutada para no filtrar existencia por timing
  const ok = await bcrypt.compare(password, user?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalo');
    if (!user || !ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const refresh = await issueRefresh(user.id);
    res.json({
          accessToken: signAccess(user),
          refreshToken: refresh,
          user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
    });
}

export async function refresh(req, res) {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken requerido' });

  const { rows: [row] } = await pool.query(
        'SELECT * FROM refresh_tokens WHERE token_hash = $1', [hashToken(refreshToken)]);
    if (!row || row.expires_at < new Date()) {
          return res.status(401).json({ error: 'Refresh token inválido' });
    }
    if (row.revoked_at) {
          // Reuso detectado: revocar toda la familia
      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family = $1', [row.family]);
          return res.status(401).json({ error: 'Token reusado; sesión revocada' });
    }
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    const { rows: [user] } = await pool.query(
          'SELECT * FROM users WHERE id = $1 AND is_active', [row.user_id]);
    if (!user) return res.status(401).json({ error: 'Usuario inactivo' });

  const newRefresh = await issueRefresh(user.id, row.family);
    res.json({ accessToken: signAccess(user), refreshToken: newRefresh });
}

export async function logout(req, res) {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
          await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1',
                                 [hashToken(refreshToken)]);
    }
    res.json({ ok: true });
}
