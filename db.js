// db.js
// -----------------------------------------------------------------------------
// Everything about the database connection and its tables lives here.
//
// We use SQLite: a whole SQL database in a single file. On your laptop that
// file is data/forest.db, just like before.
//
// On the internet it's different. Free hosts (like Render's free plan) throw
// away every file the app writes whenever it restarts or redeploys, so a
// database FILE there would lose every account. Instead, in production we
// connect to Turso: a hosted service that runs SQLite (its open-source fork,
// called libSQL) on its own servers and keeps the data safe for us.
//
// The neat part: one library, `@libsql/client`, talks to BOTH. Give it a
// `file:` URL and it opens a local file. Give it a `libsql://` URL and a token,
// and it sends the same SQL over the network to Turso. The rest of the app
// doesn't know or care which one it's using.
//
// The one big difference from steps 1 to 3 (when we used better-sqlite3): every
// database call is now ASYNCHRONOUS. A query might travel across the internet,
// so it returns a Promise and we `await` it, instead of getting the answer
// back immediately. That's why you'll see `async` and `await` all over the
// code now.
// -----------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

// Where the database is. From .env locally, from the host's settings in
// production (see .env.example and the README's "Deploying" section).
//   file:./data/forest.db                        a local file (the default)
//   libsql://forest-sanctuary-you.turso.io       a Turso database
//
// (Older .env files from steps 1 to 3 set DATABASE_PATH to a file path
// instead. We still accept that, so your existing setup keeps working.)
const url =
  process.env.DATABASE_URL ||
  `file:${process.env.DATABASE_PATH || './data/forest.db'}`;

// For a local file, make sure its folder exists before SQLite creates it.
if (url.startsWith('file:')) {
  fs.mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true });
}

// The "client" is our connection. authToken is Turso's password: without it
// Turso refuses the connection. A local file doesn't need one.
const db = createClient({
  url,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// -----------------------------------------------------------------------------
// The schema: what our tables look like.
// -----------------------------------------------------------------------------
// `CREATE TABLE IF NOT EXISTS` is safe to run every time the server starts:
// it only creates a table the first time, and does nothing afterwards.
//
// users
//   id             a number SQLite picks for each new row (1, 2, 3, ...)
//   username       UNIQUE means the database itself refuses duplicates.
//                  COLLATE NOCASE makes "Cody" and "cody" count as the same.
//   password_hash  the bcrypt hash. We NEVER store the real password.
//   is_admin       1 for admins (who can create invites), 0 for everyone else.
//                  SQLite has no true/false type, so 0 and 1 stand in for it.
//   created_at     filled in automatically with the current time.
//
// invites (used by invites.js)
//   code_hash   SHA-256 hash of the invite code. UNIQUE so we can look an
//               invite up by it quickly.
//   created_by  id of the user who made it, or NULL if it came from the CLI.
//   expires_at  after this time the code no longer works.
//   used_by     id of the account that signed up with it. NULL means "unused".
//   used_at     when that happened.
//   "REFERENCES users(id)" documents that these columns hold user ids.
//   Times are text like "2026-11-16 19:40:00" in UTC, which is what SQLite's
//   datetime('now') produces, so we can compare them directly in SQL.
//
// sessions (used by session-store.js)
//   sid      the session id. This random string is the ONLY thing stored in
//            the browser's cookie.
//   sess     the session data (e.g. { userId: 1, username: "cody", ... })
//            saved as JSON text.
//   expires  when the session stops being valid, as a Unix time in ms.
// -----------------------------------------------------------------------------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash   TEXT    NOT NULL UNIQUE,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT    NOT NULL,
    used_by     INTEGER REFERENCES users(id),
    used_at     TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT    PRIMARY KEY,
    sess    TEXT    NOT NULL,
    expires INTEGER NOT NULL
  )`,
];

// -----------------------------------------------------------------------------
// initDatabase: create the tables. server.js and scripts/create-invite.js call
// this once, before doing anything else.
// -----------------------------------------------------------------------------
// It used to happen automatically when db.js was loaded, but `require()` can't
// wait for anything, and creating tables over the network has to be awaited.
let ready;
function initDatabase() {
  // Remember the Promise, so calling this twice only does the work once.
  ready ??= (async () => {
    // WAL ("write-ahead logging") lets reads and writes happen at the same
    // time without blocking each other. It only means something for a local
    // file; Turso manages its own storage.
    if (url.startsWith('file:')) {
      await db.execute('PRAGMA journal_mode = WAL');
    }

    // batch() sends several statements in one go, inside one transaction.
    // Over the network that's one round trip instead of three.
    await db.batch(SCHEMA, 'write');

    // A tiny "migration": a database made in step 1 or 2 has a users table
    // WITHOUT is_admin, and `CREATE TABLE IF NOT EXISTS` won't change an
    // existing table. So we ask which columns it has and add the missing one.
    const { rows } = await db.execute('PRAGMA table_info(users)');
    if (!rows.some((col) => col.name === 'is_admin')) {
      await db.batch(
        [
          'ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
          // The first person who signed up becomes the admin.
          'UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)',
        ],
        'write'
      );
    }
  })();
  return ready;
}

// -----------------------------------------------------------------------------
// Queries.
//
// The `?` marks are placeholders. We pass the real values separately in
// `args`, and SQLite treats them strictly as data, never as SQL. This is what
// protects us from "SQL injection", where someone types SQL into a form field
// hoping it gets run. Never build SQL by gluing strings together with user
// input!
//
// db.execute() resolves to a result with:
//   rows             the rows found, each usable like an object (row.username)
//   rowsAffected     how many rows an INSERT/UPDATE/DELETE changed
//   lastInsertRowid  the id of a newly inserted row (as a BigInt)
// -----------------------------------------------------------------------------

// createUser takes `conn` so it can run inside a transaction (invites.js
// passes its transaction in) or directly on `db`.
async function createUser(username, passwordHash, conn = db) {
  // The very first account becomes the admin. That's you: you create the
  // first invite from the command line (see scripts/create-invite.js), use it
  // yourself, and from then on you can make invites in the browser.
  const { rows } = await conn.execute('SELECT COUNT(*) AS count FROM users');
  const isAdmin = rows[0].count === 0 ? 1 : 0;

  const result = await conn.execute({
    sql: 'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
    args: [username, passwordHash, isAdmin],
  });
  // SQLite ids can in theory be bigger than a JavaScript number can hold, so
  // the library hands back a BigInt. Ours will never get that big.
  return Number(result.lastInsertRowid);
}

// Each returns the first matching row, or undefined if there is none.
async function findUserByUsername(username) {
  const { rows } = await db.execute({
    sql: 'SELECT id, username, password_hash, is_admin FROM users WHERE username = ?',
    args: [username],
  });
  return rows[0];
}

async function findUserById(id) {
  const { rows } = await db.execute({
    sql: 'SELECT id, username, is_admin FROM users WHERE id = ?',
    args: [id],
  });
  return rows[0];
}

module.exports = { db, initDatabase, createUser, findUserByUsername, findUserById };
