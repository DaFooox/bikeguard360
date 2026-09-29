'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error('SQLite is not available. BikeGuard360 needs Node.js >= 22.5 and must be started with');
  console.error('--experimental-sqlite on Node 22.5–22.12 (the npm scripts already do this).');
  process.exit(1);
}

// Values node:sqlite cannot bind are stored as NULL
const bindable = (v) => (v === undefined ? null : v);

// Thin wrapper around node:sqlite that offers the small part of the
// better-sqlite3 API this project uses: named parameters may be passed as an
// object with extra keys, undefined becomes NULL, and db.transaction(fn).
class Statement {
  constructor(stmt, sql) {
    this.stmt = stmt;
    this.names = [...new Set([...sql.matchAll(/[@:$]([A-Za-z_]\w*)/g)].map((m) => m[1]))];
  }

  args(params) {
    const [first] = params;
    if (params.length === 1 && first && typeof first === 'object' && !Buffer.isBuffer(first) && this.names.length) {
      const named = {};
      for (const name of this.names) named[name] = bindable(first[name]);
      return [named];
    }
    return params.map(bindable);
  }

  run(...params) {
    const { changes, lastInsertRowid } = this.stmt.run(...this.args(params));
    return { changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) };
  }

  get(...params) { return this.stmt.get(...this.args(params)); }

  all(...params) { return this.stmt.all(...this.args(params)); }
}

class Database {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.cache = new Map();
  }

  prepare(sql) {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      stmt = new Statement(this.db.prepare(sql), sql);
      this.cache.set(sql, stmt);
    }
    return stmt;
  }

  exec(sql) { this.db.exec(sql); }

  transaction(fn) {
    return (...args) => {
      this.db.exec('BEGIN');
      try {
        const result = fn(...args);
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    };
  }

  close() { this.db.close(); }
}

function openDatabase(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

module.exports = { openDatabase };
