// invites.js
// -----------------------------------------------------------------------------
// Invite codes: the only way to get an account.
//
// An invite is a long random code. Whoever has it can sign up ONCE, before it
// expires. The admin (the first user) makes invites on the /admin/invites
// page, or from the command line with `npm run invite`.
//
// The big idea in this file: we treat invite codes like passwords. The
// database never stores the code itself, only a HASH of it. If someone ever
// got a copy of data/forest.db, they would see the hashes but couldn't turn
// them back into working invite links.
// -----------------------------------------------------------------------------

const crypto = require('node:crypto');
const { db, createUser } = require('./db');

// How long a new invite stays valid. Can be changed in .env.
const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS) || 7;

// One row per invite.
//   code_hash   SHA-256 hash of the code (see hashCode below). UNIQUE so we can
//               look an invite up by it quickly.
//   created_by  id of the user who made it, or NULL if it came from the CLI.
//   expires_at  after this time the code no longer works.
//   used_by     id of the account that signed up with it. NULL means "unused".
//   used_at     when that happened.
//
// "REFERENCES users(id)" documents that these columns hold user ids. (SQLite
// only enforces it if you turn on foreign keys, which we haven't yet.)
//
// Times are stored as text like "2026-11-16 19:40:00" in UTC, which is what
// SQLite's datetime('now') produces, so we can compare them directly in SQL.
db.exec(`
  CREATE TABLE IF NOT EXISTS invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash   TEXT    NOT NULL UNIQUE,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT    NOT NULL,
    used_by     INTEGER REFERENCES users(id),
    used_at     TEXT
  )
`);

const insertInvite = db.prepare(`
  INSERT INTO invites (code_hash, created_by, expires_at)
  VALUES (?, ?, datetime('now', ?))
`);

// "Usable" means: this exact code, never used, and not yet expired.
const selectUsableInvite = db.prepare(`
  SELECT id FROM invites
  WHERE code_hash = ? AND used_by IS NULL AND expires_at > datetime('now')
`);

// The `AND used_by IS NULL` here matters: if the invite was used in the
// meantime, this UPDATE changes 0 rows, and we notice (see redeem below).
const markInviteUsed = db.prepare(`
  UPDATE invites SET used_by = ?, used_at = datetime('now')
  WHERE id = ? AND used_by IS NULL
`);

// For the admin page. LEFT JOIN pulls in the username of whoever used each
// invite (or NULL if nobody has yet).
const selectAllInvites = db.prepare(`
  SELECT invites.id, invites.created_at, invites.expires_at, invites.used_at,
         users.username AS used_by_name,
         invites.used_by IS NULL AND invites.expires_at <= datetime('now') AS expired
  FROM invites
  LEFT JOIN users ON users.id = invites.used_by
  ORDER BY invites.id DESC
`);

// -----------------------------------------------------------------------------
// hashCode: turn a code into what we store.
// -----------------------------------------------------------------------------
// Why SHA-256 here, when passwords use slow bcrypt? bcrypt is slow on purpose
// because people pick short, guessable passwords. Our codes are 32 random
// bytes (256 bits) made by the computer, so there is nothing to guess: even
// at a trillion tries per second it would take far longer than the age of the
// universe. A fast hash is enough, and it lets us look a code up directly
// with `WHERE code_hash = ?`. (bcrypt adds a random salt, so the same code
// would hash differently every time and we couldn't search for it.)
function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// -----------------------------------------------------------------------------
// createInvite: make a new code and save its hash. Returns the code itself.
// -----------------------------------------------------------------------------
// This is the ONLY moment the real code exists. Show it to the admin once,
// and it's gone: like a GitHub token, you can't look it up again later.
function createInvite(createdByUserId = null) {
  // crypto.randomBytes uses the operating system's secure random generator.
  // (Never use Math.random() for anything security related: it's predictable.)
  // base64url turns the bytes into URL-safe text, 43 characters long.
  const code = crypto.randomBytes(32).toString('base64url');

  // datetime('now', '+7 days') is SQLite date math.
  insertInvite.run(hashCode(code), createdByUserId, `+${INVITE_TTL_DAYS} days`);
  return code;
}

// Is this code good to use right now? Cheap check, used before we spend time
// hashing the password.
function isInviteUsable(code) {
  return Boolean(code) && Boolean(selectUsableInvite.get(hashCode(code)));
}

// -----------------------------------------------------------------------------
// signUpWithInvite: create the account AND use up the invite, together.
// -----------------------------------------------------------------------------
// db.transaction() wraps a function so everything inside it happens all
// together or not at all. If anything throws halfway through, SQLite undoes
// ("rolls back") every change made inside it.
//
// That matters here: we must never end up with an account whose invite is
// still unused (someone could reuse it), or an invite marked used with no
// account to show for it.
//
// Returns the new user's id, or null if the invite is invalid, used or expired.
const signUpWithInvite = db.transaction((code, username, passwordHash) => {
  const invite = selectUsableInvite.get(hashCode(code));
  if (!invite) return null;

  // If the username is taken this throws, and the transaction rolls back,
  // so the invite stays unused and the person can try another name.
  const userId = createUser(username, passwordHash);

  const result = markInviteUsed.run(userId, invite.id);
  if (result.changes !== 1) {
    // Someone else used it a split second before us. Throwing undoes the
    // createUser above. (better-sqlite3 runs one statement at a time, so this
    // can't really happen in our single server, but checking costs nothing.)
    throw new Error('Invite was already used');
  }
  return userId;
});

function listInvites() {
  return selectAllInvites.all();
}

module.exports = {
  INVITE_TTL_DAYS,
  createInvite,
  isInviteUsable,
  signUpWithInvite,
  listInvites,
};
