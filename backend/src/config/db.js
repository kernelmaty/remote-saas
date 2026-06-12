import pg from 'pg';
import 'dotenv/config';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Ejecuta una query con el tenant fijado en la transacción,
 * para que apliquen las políticas RLS (set_config app.company_id).
 */
export async function tenantQuery(companyId, text, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
