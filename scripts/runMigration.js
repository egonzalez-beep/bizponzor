const fs = require('fs');
const path = require('path');
const { getPool } = require('../lib/db-postgres');

(async () => {
  try {
    const sqlPath = path.join(__dirname, '..', 'migrations', 'init.sql');
    let sql = fs.readFileSync(sqlPath, 'utf8');
    sql = sql
      .split('\n')
      .filter((line) => !/^\s*--/.test(line))
      .join('\n');
    const parts = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const pool = getPool();
    for (const p of parts) {
      await pool.query(`${p};`);
    }
    console.log('✅ DB lista (PostgreSQL)');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en migración:', err);
    process.exit(1);
  }
})();
