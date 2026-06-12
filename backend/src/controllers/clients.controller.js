import { z } from 'zod';
import { tenantQuery } from '../config/db.js';

const clientSchema = z.object({
  name: z.string().min(2),
  contactEmail: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function list(req, res) {
  const { rows } = await tenantQuery(req.user.companyId,
    `SELECT c.*, count(d.id) FILTER (WHERE d.is_active) AS device_count
     FROM clients c LEFT JOIN devices d ON d.client_id = c.id
     WHERE c.is_active GROUP BY c.id ORDER BY c.name`);
  res.json(rows);
}

export async function create(req, res) {
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, contactEmail, phone, notes } = parsed.data;
  const { rows: [row] } = await tenantQuery(req.user.companyId,
    `INSERT INTO clients (company_id, name, contact_email, phone, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.companyId, name, contactEmail ?? null, phone ?? null, notes ?? null]);
  res.status(201).json(row);
}

export async function getOne(req, res) {
  const { rows: [row] } = await tenantQuery(req.user.companyId,
    'SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(row);
}

export async function update(req, res) {
  const parsed = clientSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const { rows: [row] } = await tenantQuery(req.user.companyId,
    `UPDATE clients SET
       name = COALESCE($2, name),
       contact_email = COALESCE($3, contact_email),
       phone = COALESCE($4, phone),
       notes = COALESCE($5, notes)
     WHERE id = $1 RETURNING *`,
    [req.params.id, p.name ?? null, p.contactEmail ?? null, p.phone ?? null, p.notes ?? null]);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(row);
}

export async function remove(req, res) {
  await tenantQuery(req.user.companyId,
    'UPDATE clients SET is_active = false WHERE id = $1', [req.params.id]);
  res.status(204).end();
}
