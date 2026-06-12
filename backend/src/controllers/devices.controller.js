import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { tenantQuery } from '../config/db.js';

export async function listByClient(req, res) {
  const { rows } = await tenantQuery(req.user.companyId,
    `SELECT id, name, os, is_online, last_seen_at, created_at
     FROM devices WHERE client_id = $1 AND is_active ORDER BY name`, [req.params.id]);
  res.json(rows);
}

/** Alta de dispositivo: devuelve el device_token UNA sola vez (se guarda hasheado). */
export async function register(req, res) {
  const schema = z.object({
    clientId: z.string().uuid(),
    name: z.string().min(2),
    os: z.enum(['windows', 'macos', 'linux']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = await bcrypt.hash(rawToken, 12);
  const { rows: [row] } = await tenantQuery(req.user.companyId,
    `INSERT INTO devices (company_id, client_id, name, os, device_token_hash)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, os, created_at`,
    [req.user.companyId, parsed.data.clientId, parsed.data.name, parsed.data.os ?? null, tokenHash]);

  res.status(201).json({ ...row, deviceToken: rawToken,
    warning: 'Guardar este token: no vuelve a mostrarse.' });
}

export async function revoke(req, res) {
  await tenantQuery(req.user.companyId,
    'UPDATE devices SET is_active = false WHERE id = $1', [req.params.id]);
  res.status(204).end();
}
