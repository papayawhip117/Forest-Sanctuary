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
//   is_admin       1 for admins (who can create invites), 0 for everyone else.
//                  SQLite has no true/false type, so 0 and 1 stand in for it.
//   created_at     filled in automatically with the current time.
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// -----------------------------------------------------------------------------
// A tiny "migration".
//
// If you ran step 1 or 2 already, your data/forest.db has a users table
// WITHOUT the is_admin column, and `CREATE TABLE IF NOT EXISTS` above won't
// change an existing table. So we ask SQLite which columns the table has
// (PRAGMA table_info) and add the missing one. Real projects use a migration
// tool for this, but underneath it's the same idea: change an existing
// database step by step, without losing the data in it.
// -----------------------------------------------------------------------------
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((col) => col.name);
if (!userColumns.includes('is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  // Whoever signed up first in the old database becomes the admin, so you
  // don't lock yourself out of the new invite page.
  db.exec('UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)');
}

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
  'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)'
);
const countUsers = db.prepare('SELECT COUNT(*) AS count FROM users');
const selectUserByName = db.prepare(
  'SELECT id, username, password_hash, is_admin FROM users WHERE username = ?'
);
const selectUserById = db.prepare(
  'SELECT id, username, is_admin FROM users WHERE id = ?'
);

// Small helper functions so the rest of the app never writes SQL directly.
function createUser(username, passwordHash) {
  // The very first account becomes the admin. That's you: you create the
  // first invite from the command line (see scripts/create-invite.js), use it
  // yourself, and from then on you can make invites in the browser.
  const isAdmin = countUsers.get().count === 0 ? 1 : 0;

  // .run() is for statements that change data. It tells us the new row's id.
  const result = insertUser.run(username, passwordHash, isAdmin);
  return result.lastInsertRowid;
}

function findUserByUsername(username) {
  // .get() returns the first matching row as an object, or undefined.
  return selectUserByName.get(username);
}

function findUserById(id) {
  return selectUserById.get(id);
}

module.exports = { db, createUser, findUserByUsername, findUserById };
