import { tenantQuery } from '../config/db.js';

export async function summary(req, res) {
  const cid = req.user.companyId;
  const { rows: [row] } = await tenantQuery(cid, `
    SELECT
      (SELECT count(*) FROM sessions WHERE company_id = $1
         AND started_at::date = CURRENT_DATE)                          AS sessions_today,
      (SELECT count(*) FROM sessions WHERE company_id = $1
         AND status = 'active')                                        AS sessions_active,
      (SELECT count(*) FROM tickets  WHERE company_id = $1
         AND status IN ('open','in_progress'))                         AS tickets_open,
      (SELECT count(*) FROM devices  WHERE company_id = $1
         AND is_online AND is_active)                                  AS devices_online,
      (SELECT count(*) FROM clients  WHERE company_id = $1 AND is_active) AS clients_total
  `, [cid]);
  res.json(row);
}

export async function activity(req, res) {
  const { rows } = await tenantQuery(req.user.companyId, `
    SELECT d::date AS day, count(s.id) AS sessions,
           COALESCE(sum(s.duration_sec), 0) AS total_seconds
    FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, '1 day') d
    LEFT JOIN sessions s ON s.company_id = $1 AND s.started_at::date = d::date
    GROUP BY d ORDER BY d
  `, [req.user.companyId]);
  res.json(rows);
}
