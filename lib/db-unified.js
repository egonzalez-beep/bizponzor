'use strict';

const { Mutex } = require('async-mutex');
const { adaptSqlForPostgres } = require('./sql-pg');

const usePg = !!process.env.DATABASE_URL;
const sqliteMutex = new Mutex();

let sqliteDb = null;

function getSqlite() {
  if (!sqliteDb) {
    sqliteDb = require('./db-sqlite');
  }
  return sqliteDb;
}

function getPgPool() {
  return require('./db-postgres').getPool();
}

function wrapSqliteStmt(stmt) {
  return {
    get: (...params) => Promise.resolve(stmt.get(...params)),
    all: (...params) => Promise.resolve(stmt.all(...params)),
    run: (...params) => {
      const r = stmt.run(...params);
      return Promise.resolve({
        changes: r.changes,
        lastInsertRowid: r.lastInsertRowid
      });
    }
  };
}

function prepareSqlite(sql) {
  const stmt = getSqlite().prepare(sql);
  return wrapSqliteStmt(stmt);
}

function preparePg(sql) {
  const text = adaptSqlForPostgres(sql);
  const pool = getPgPool();
  return {
    get: (...params) =>
      pool.query(text, params).then((res) => res.rows[0]),
    all: (...params) =>
      pool.query(text, params).then((res) => res.rows),
    run: (...params) =>
      pool.query(text, params).then((res) => ({
        changes: res.rowCount ?? 0,
        lastInsertRowid: null
      }))
  };
}

async function execSqlite(sql) {
  getSqlite().exec(sql);
}

async function execPg(sql) {
  const pool = getPgPool();
  const text = adaptSqlForPostgres(sql);
  await pool.query(text);
}

async function transactionSqlite(fn) {
  return sqliteMutex.runExclusive(async () => {
    const db = getSqlite();
    db.exec('BEGIN');
    try {
      const tx = {
        prepare: (sql) => wrapSqliteStmt(db.prepare(sql))
      };
      const out = await fn(tx);
      db.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {
        /* ignore */
      }
      throw e;
    }
  });
}

async function transactionPg(fn) {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      prepare: (sql) => {
        const text = adaptSqlForPostgres(sql);
        return {
          get: (...params) =>
            client.query(text, params).then((res) => res.rows[0]),
          all: (...params) =>
            client.query(text, params).then((res) => res.rows),
          run: (...params) =>
            client.query(text, params).then((res) => ({
              changes: res.rowCount ?? 0,
              lastInsertRowid: null
            }))
        };
      }
    };
    const out = await fn(tx);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

if (usePg) {
  console.log('🐘 Usando PostgreSQL');
} else {
  console.log('🗄️ Usando SQLite');
}

module.exports = {
  prepare: usePg ? preparePg : prepareSqlite,
  exec: usePg ? execPg : execSqlite,
  transaction: usePg ? transactionPg : transactionSqlite
};
