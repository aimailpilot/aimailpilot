import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await pool.query(`SELECT id, name FROM organizations WHERE name ILIKE '%aegis%'`);
  console.log(r.rows);
  await pool.end();
})();
