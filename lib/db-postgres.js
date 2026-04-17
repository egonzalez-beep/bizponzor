const { Pool } = require('pg');

const isProd = process.env.NODE_ENV === 'production';

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for PostgreSQL');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isProd ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

module.exports = {
  getPool,
  query: (text, params) => getPool().query(text, params)
};
