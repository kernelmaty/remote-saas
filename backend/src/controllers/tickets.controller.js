import { z } from 'zod';
import { tenantQuery } from '../config/db.js';

const ticketSchema = z.object({
    title: z.string().min(3),
    description: z.string().optional().nullable(),
    clientId: z.string().uuid().optional().nullable(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

export async function list(req, res) {
    const { status, priority, clientId, page = 1, limit = 25 } = req.query;
    const conds = ['t.company_id = $1'];
    const params = [req.user.companyId];
    if (status)   { params.push(status);   conds.push(`t.status = $${params.length}`); }
    if (priority) { params.push(priority); conds.push(`t.priority = $${params.length}`); }
    if (clientId) { params.push(clientId); conds.push(`t.client_id = $${params.length}`); }
    const limitVal  = Math.min(Number(limit), 100);
    const offsetVal = (Number(page) - 1) * limitVal;
    params.push(limitVal, offsetVal);
    const limitIdx  = params.length - 1;
    const offsetIdx = params.length;

  const { rows } = await tenantQuery(req.user.companyId,
                                         `SELECT t.*, c.name AS client_name, u.full_name AS assigned_name
                                              FROM tickets t
                                                   LEFT JOIN clients c ON c.id = t.client_id
                                                        LEFT JOIN users u ON u.id = t.assigned_to
                                                             WHERE ${conds.join(' AND ')}
                                                                  ORDER BY t.created_at DESC
                                                                       LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    res.json(rows);
}

export async function create(req, res) {
    const parsed = ticketSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { title, description, clientId, priority } = parsed.data;
    const { rows: [row] } = await tenantQuery(req.user.companyId,
                                                  `INSERT INTO tickets (company_id, client_id, title, description, priority, created_by)
                                                       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                                                  [req.user.companyId, clientId ?? null, title, description ?? null, priority, req.user.id]);
    res.status(201).json(row);
}

export async function getOne(req, res) {
    const { rows: [ticket] } = await tenantQuery(req.user.companyId,
                                                     'SELECT * FROM tickets WHERE id = $1', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
    const { rows: comments } = await tenantQuery(req.user.companyId,
                                                     `SELECT tc.*, u.full_name FROM ticket_comments tc
                                                          LEFT JOIN users u ON u.id = tc.user_id
                                                               WHERE tc.ticket_id = $1 ORDER BY tc.created_at`, [req.params.id]);
    res.json({ ...ticket, comments });
}

export async function update(req, res) {
    const schema = z.object({
          status:     z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
          priority:   z.enum(['low', 'medium', 'high', 'critical']).optional(),
          assignedTo: z.string().uuid().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const p = parsed.data;
    // assignedTo === null significa desasignar explícitamente;
  // assignedTo === undefined significa no tocar el campo.
  const unassign = Object.prototype.hasOwnProperty.call(p, 'assignedTo') && p.assignedTo === null;
    const { rows: [row] } = await tenantQuery(req.user.companyId,
                                                  `UPDATE tickets SET
                                                         status     = COALESCE($2, status),
                                                                priority   = COALESCE($3, priority),
                                                                       assigned_to = CASE WHEN $4 THEN NULL ELSE COALESCE($5::uuid, assigned_to) END,
                                                                              closed_at  = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE closed_at END
                                                                                   WHERE id = $1 RETURNING *`,
                                                  [req.params.id, p.status ?? null, p.priority ?? null, unassign, p.assignedTo ?? null]);
    if (!row) return res.status(404).json({ error: 'Ticket no encontrado' });
    res.json(row);
}

export async function comment(req, res) {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'body requerido' });
    const { rows: [row] } = await tenantQuery(req.user.companyId,
                                                  `INSERT INTO ticket_comments (ticket_id, user_id, body)
                                                       SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM tickets WHERE id = $1)
                                                            RETURNING *`, [req.params.id, req.user.id, body]);
    if (!row) return res.status(404).json({ error: 'Ticket no encontrado' });
    res.status(201).json(row);
}
