const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

const isPostgres = Boolean(process.env.DATABASE_URL);
const sqlitePath = path.join(__dirname, "database.db");

function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function createSqliteAdapter() {
  const db = new sqlite3.Database(sqlitePath);

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve({
          changes: this.changes || 0,
          lastID: this.lastID || null
        });
      });
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  async function ensureColumn(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    const exists = columns.some(item => item.name === column);
    if (!exists) {
      await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  async function init() {
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        is_verified INTEGER DEFAULT 0,
        verification_code TEXT,
        verification_expires_at TEXT,
        created_at TEXT,
        last_login_at TEXT
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        filename TEXT,
        jobRole TEXT,
        score INTEGER,
        jobMatch INTEGER,
        skills INTEGER,
        experience INTEGER,
        format INTEGER,
        good TEXT,
        bad TEXT,
        suggestions TEXT,
        resume_text TEXT,
        enhanced_resume TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureColumn("users", "is_verified", "INTEGER DEFAULT 0");
    await ensureColumn("users", "verification_code", "TEXT");
    await ensureColumn("users", "verification_expires_at", "TEXT");
    await ensureColumn("users", "created_at", "TEXT");
    await ensureColumn("users", "last_login_at", "TEXT");
    await ensureColumn("reports", "resume_text", "TEXT");
    await ensureColumn("reports", "enhanced_resume", "TEXT");
  }

  function close() {
    return new Promise((resolve, reject) => {
      db.close(err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  return { run, get, all, init, close, dialect: "sqlite" };
}

function createPostgresAdapter() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
  });

  async function run(sql, params = []) {
    const result = await pool.query(convertPlaceholders(sql), params);
    return {
      changes: result.rowCount || 0,
      lastID: result.rows?.[0]?.id || null
    };
  }

  async function get(sql, params = []) {
    const result = await pool.query(convertPlaceholders(sql), params);
    return result.rows[0] || null;
  }

  async function all(sql, params = []) {
    const result = await pool.query(convertPlaceholders(sql), params);
    return result.rows || [];
  }

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT,
        is_verified INTEGER DEFAULT 0,
        verification_code TEXT,
        verification_expires_at TEXT,
        created_at TEXT,
        last_login_at TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        filename TEXT,
        jobrole TEXT,
        score INTEGER,
        jobmatch INTEGER,
        skills INTEGER,
        experience INTEGER,
        format INTEGER,
        good TEXT,
        bad TEXT,
        suggestions TEXT,
        resume_text TEXT,
        enhanced_resume TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TEXT`);
    await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS resume_text TEXT`);
    await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS enhanced_resume TEXT`);
  }

  function close() {
    return pool.end();
  }

  return { run, get, all, init, close, dialect: "postgres" };
}

module.exports = isPostgres ? createPostgresAdapter() : createSqliteAdapter();
