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
// Instead we keep sessions in the same database as our users (a local SQLite
// file on your laptop, Turso in production). Writing
// the store ourselves is only ~60 lines, and it shows that a "session" is
// nothing magic: it is a row in a table, looked up by a random id.
// -----------------------------------------------------------------------------

const session = require('express-session');
const { db } = require('./db');

// The sessions table is created in db.js, with the others.

// A small helper: run one statement with some arguments.
function run(sql, ...args) {
  return db.execute({ sql, args });
}

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
//
// Our database calls return Promises, so we bridge the two styles with
// .then(success, failure): when the Promise finishes, we call the callback.
class SqliteSessionStore extends session.Store {
  // Look up a session by id. Called on every request that carries a cookie.
  get(sid, callback) {
    run('SELECT sess FROM sessions WHERE sid = ? AND expires > ?', sid, Date.now()).then(
      // No row (unknown or expired id) means "no session": callback(null, null).
      ({ rows }) => callback(null, rows[0] ? JSON.parse(rows[0].sess) : null),
      callback
    );
  }

  // Save (create or update) a session.
  // "INSERT OR REPLACE" creates the row, or overwrites it if the sid exists.
  set(sid, sess, callback) {
    run(
      'INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?, ?, ?)',
      sid,
      JSON.stringify(sess),
      expiryOf(sess)
    ).then(() => callback(null), callback);
  }

  // Delete a session. This is what logging out does.
  destroy(sid, callback) {
    run('DELETE FROM sessions WHERE sid = ?', sid).then(() => callback(null), callback);
  }

  // Push the expiry date forward without rewriting the data. express-session
  // calls this on each request when `rolling` is on (see server.js), so an
  // active user stays logged in and an idle one eventually expires.
  touch(sid, sess, callback) {
    run('UPDATE sessions SET expires = ? WHERE sid = ?', expiryOf(sess), sid).then(
      () => callback(null),
      callback
    );
  }
}

// Expired rows are already ignored by get(), but they would pile up forever.
// server.js sweeps them out at start-up and then every 15 minutes.
async function pruneExpiredSessions() {
  await run('DELETE FROM sessions WHERE expires <= ?', Date.now());
}

module.exports = { SqliteSessionStore, pruneExpiredSessions };
