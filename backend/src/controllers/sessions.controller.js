import { tenantQuery } from '../config/db.js';

export async function list(req, res) {
  const { deviceId, technicianId, page = 1, limit = 25 } = req.query;
  const conds = ['s.company_id = $1'];
  const params = [req.user.companyId];
  if (deviceId)     { params.push(deviceId);     conds.push(`s.device_id = $${params.length}`); }
  if (technicianId) { params.push(technicianId); conds.push(`s.technician_id = $${params.length}`); }
  params.push(Math.min(Number(limit), 100), (Number(page) - 1) * Number(limit));

  const { rows } = await tenantQuery(req.user.companyId,
    `SELECT s.id, s.status, s.connection_type, s.started_at, s.ended_at, s.duration_sec,
            d.name AS device_name, c.name AS client_name, u.full_name AS technician_name
     FROM sessions s
     JOIN devices d ON d.id = s.device_id
     JOIN clients c ON c.id = d.client_id
     JOIN users u   ON u.id = s.technician_id
     WHERE ${conds.join(' AND ')}
     ORDER BY s.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json(rows);
}

export async function getOne(req, res) {
  const { rows: [session] } = await tenantQuery(req.user.companyId,
    'SELECT * FROM sessions WHERE id = $1', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  const { rows: events } = await tenantQuery(req.user.companyId,
    'SELECT * FROM session_events WHERE session_id = $1 ORDER BY created_at', [req.params.id]);
  res.json({ ...session, events });
}
