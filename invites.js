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
// got a copy of the database, they would see the hashes but couldn't turn
// them back into working invite links.
// -----------------------------------------------------------------------------

const crypto = require('node:crypto');
const { db, createUser } = require('./db');

// How long a new invite stays valid. Can be changed in .env.
const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS) || 7;

// The invites table itself is created in db.js, with the others.

// "Usable" means: this exact code, never used, and not yet expired.
const SELECT_USABLE_INVITE = `
  SELECT id FROM invites
  WHERE code_hash = ? AND used_by IS NULL AND expires_at > datetime('now')
`;

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
async function createInvite(createdByUserId = null) {
  // crypto.randomBytes uses the operating system's secure random generator.
  // (Never use Math.random() for anything security related: it's predictable.)
  // base64url turns the bytes into URL-safe text, 43 characters long.
  const code = crypto.randomBytes(32).toString('base64url');

  // datetime('now', '+7 days') is SQLite date math.
  await db.execute({
    sql: `INSERT INTO invites (code_hash, created_by, expires_at)
          VALUES (?, ?, datetime('now', ?))`,
    args: [hashCode(code), createdByUserId, `+${INVITE_TTL_DAYS} days`],
  });
  return code;
}

// Is this code good to use right now? Cheap check, used before we spend time
// hashing the password.
async function isInviteUsable(code) {
  if (!code) return false;
  const { rows } = await db.execute({ sql: SELECT_USABLE_INVITE, args: [hashCode(code)] });
  return rows.length > 0;
}

// -----------------------------------------------------------------------------
// signUpWithInvite: create the account AND use up the invite, together.
// -----------------------------------------------------------------------------
// A transaction groups several statements so they happen all together or not
// at all. If anything fails halfway through, we "roll back" and the database
// undoes every change made inside it.
//
// That matters here: we must never end up with an account whose invite is
// still unused (someone could reuse it), or an invite marked used with no
// account to show for it.
//
// db.transaction('write') starts an "interactive" transaction: we send
// statements one by one, look at the answers, and decide what to do next,
// then commit() or rollback(). 'write' means it locks the database for
// writing straight away, so no one else can sneak a change in between our
// statements. (Turso gives up on a transaction after 5 seconds, so we keep
// the slow bcrypt hashing OUTSIDE it: the caller hashes first.)
//
// Returns the new user's id, or null if the invite is invalid, used or expired.
async function signUpWithInvite(code, username, passwordHash) {
  const tx = await db.transaction('write');
  try {
    const { rows } = await tx.execute({ sql: SELECT_USABLE_INVITE, args: [hashCode(code)] });
    const invite = rows[0];
    if (!invite) {
      await tx.rollback();
      return null;
    }

    // If the username is taken this throws, and the catch below rolls back,
    // so the invite stays unused and the person can try another name.
    const userId = await createUser(username, passwordHash, tx);

    // The `AND used_by IS NULL` matters: if the invite was used in the
    // meantime, this UPDATE changes 0 rows, and we notice.
    const result = await tx.execute({
      sql: `UPDATE invites SET used_by = ?, used_at = datetime('now')
            WHERE id = ? AND used_by IS NULL`,
      args: [userId, invite.id],
    });
    if (result.rowsAffected !== 1) {
      throw new Error('Invite was already used');
    }

    await tx.commit();
    return userId;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    // Always release the transaction, whatever happened above.
    tx.close();
  }
}

// For the admin page. LEFT JOIN pulls in the username of whoever used each
// invite (or NULL if nobody has yet).
async function listInvites() {
  const { rows } = await db.execute(`
    SELECT invites.id, invites.created_at, invites.expires_at, invites.used_at,
           users.username AS used_by_name,
           invites.used_by IS NULL AND invites.expires_at <= datetime('now') AS expired
    FROM invites
    LEFT JOIN users ON users.id = invites.used_by
    ORDER BY invites.id DESC
  `);
  return rows;
}

module.exports = {
  INVITE_TTL_DAYS,
  createInvite,
  isInviteUsable,
  signUpWithInvite,
  listInvites,
};
