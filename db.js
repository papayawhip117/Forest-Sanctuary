// db.js
// -----------------------------------------------------------------------------
// Everything about the database lives in this one file.
//
// We use SQLite: a whole SQL database stored in a single file on disk. There is
// no separate database server to install or run, which makes it perfect for
// learning. `better-sqlite3` is the Node library that talks to that file.
// -----------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Read the file location from .env (see .env.example), with a fallback.
const dbPath = process.env.DATABASE_PATH || './data/forest.db';

// Make sure the folder exists before SQLite tries to create the file in it.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Opening the database creates the file the first time.
const db = new Database(dbPath);

// WAL ("write-ahead logging") mode lets reads and writes happen at the same
// time without blocking each other. It is the recommended mode for web apps.
db.pragma('journal_mode = WAL');

// -----------------------------------------------------------------------------
// The schema: what our table looks like.
//
// `CREATE TABLE IF NOT EXISTS` is safe to run every time the server starts:
// it only creates the table the first time, and does nothing afterwards.
//
//   id             a number SQLite picks for each new row (1, 2, 3, ...)
//   username       UNIQUE means the database itself refuses duplicates.
//                  COLLATE NOCASE makes "Cody" and "cody" count as the same.
//   password_hash  the bcrypt hash. We NEVER store the real password.
//   created_at     filled in automatically with the current time.
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// -----------------------------------------------------------------------------
// Prepared statements.
//
// The `?` marks are placeholders. We pass the real values separately when we
// run the statement, and SQLite treats them strictly as data, never as SQL.
// This is what protects us from "SQL injection", where someone types SQL
// into a form field hoping it gets run. Never build SQL by gluing strings
// together with user input!
// -----------------------------------------------------------------------------
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const selectUserByName = db.prepare(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
);

// Small helper functions so the rest of the app never writes SQL directly.
function createUser(username, passwordHash) {
  // .run() is for statements that change data. It tells us the new row's id.
  const result = insertUser.run(username, passwordHash);
  return result.lastInsertRowid;
}

function findUserByUsername(username) {
  // .get() returns the first matching row as an object, or undefined.
  return selectUserByName.get(username);
}

module.exports = { db, createUser, findUserByUsername };
