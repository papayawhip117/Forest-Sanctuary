// session-store.js
// -----------------------------------------------------------------------------
// Where session data lives on the server.
//
// express-session (the library that handles sessions for us) does not care
// WHERE session data is kept. It just needs a "store" object with a few
// methods: get, set, destroy and touch. Its built-in default keeps everything
// in memory, which means every restart logs everybody out (and it leaks memory,
// so it is not meant for real use).
//
// Instead we keep sessions in the same SQLite database as our users. Writing
// the store ourselves is only ~60 lines, and it shows that a "session" is
// nothing magic: it is a row in a table, looked up by a random id.
// -----------------------------------------------------------------------------

const session = require('express-session');
const { db } = require('./db');

// One row per session.
//   sid      the session id. This random string is the ONLY thing stored in
//            the browser's cookie.
//   sess     the session data (e.g. { userId: 1, username: "cody", cookie: {...} })
//            saved as JSON text.
//   expires  when the session stops being valid, as a Unix time in milliseconds.
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT    PRIMARY KEY,
    sess    TEXT    NOT NULL,
    expires INTEGER NOT NULL
  )
`);

// Prepared statements, same idea as in db.js.
const selectSession = db.prepare(
  'SELECT sess FROM sessions WHERE sid = ? AND expires > ?'
);
// "INSERT OR REPLACE" creates the row, or overwrites it if the sid exists.
const upsertSession = db.prepare(
  'INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?, ?, ?)'
);
const deleteSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
const updateExpiry = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
const deleteExpired = db.prepare('DELETE FROM sessions WHERE expires <= ?');

// If a session somehow has no expiry date, keep it for one day.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function expiryOf(sess) {
  return sess.cookie && sess.cookie.expires
    ? new Date(sess.cookie.expires).getTime()
    : Date.now() + ONE_DAY_MS;
}

// `extends session.Store` gives us some helper methods express-session expects.
// We fill in the four that do the real work. Each one receives a `callback`
// that we must call when done: callback(error) on failure, or
// callback(null, result) on success. (That is the older Node style that
// express-session still uses.)
class SqliteSessionStore extends session.Store {
  // Look up a session by id. Called on every request that carries a cookie.
  get(sid, callback) {
    try {
      const row = selectSession.get(sid, Date.now());
      // No row (unknown or expired id) means "no session": callback(null, null).
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err);
    }
  }

  // Save (create or update) a session.
  set(sid, sess, callback) {
    try {
      upsertSession.run(sid, JSON.stringify(sess), expiryOf(sess));
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  // Delete a session. This is what logging out does.
  destroy(sid, callback) {
    try {
      deleteSession.run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  // Push the expiry date forward without rewriting the data. express-session
  // calls this on each request when `rolling` is on (see server.js), so an
  // active user stays logged in and an idle one eventually expires.
  touch(sid, sess, callback) {
    try {
      updateExpiry.run(expiryOf(sess), sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

// Expired rows are already ignored by get(), but they would pile up forever.
// Sweep them out once at start-up and then every 15 minutes.
// `.unref()` means this timer alone won't keep Node running.
function pruneExpiredSessions() {
  deleteExpired.run(Date.now());
}
pruneExpiredSessions();
setInterval(pruneExpiredSessions, 15 * 60 * 1000).unref();

module.exports = SqliteSessionStore;
