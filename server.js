// server.js
// -----------------------------------------------------------------------------
// The entry point. Run it with `npm start` (or `npm run dev` to auto-restart
// whenever you save a file).
//
// The job of this file is just to wire things together:
//   1. load settings from .env
//   2. create the Express app
//   3. plug in "middleware" (functions that run on every request),
//      including sessions, which remember who is logged in
//   4. plug in our routes
//   5. start listening for requests
// -----------------------------------------------------------------------------

// 1. Load .env into process.env. This must happen BEFORE we require any file
//    that reads process.env (like db.js), so it goes first.
require('dotenv').config();

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { db, initDatabase } = require('./db');
const { SqliteSessionStore, pruneExpiredSessions } = require('./session-store');
const { router: authRoutes } = require('./routes/auth');
const adminRoutes = require('./routes/admin');

// NODE_ENV is the usual way to tell a Node app whether it is running on your
// laptop ("development", the default) or on a real server ("production").
const isProduction = process.env.NODE_ENV === 'production';

// The session secret signs the session cookie (see below). It must be long,
// random and private. Refuse to start in production without a real one
// (the placeholder copied from .env.example doesn't count); on your laptop,
// fall back to a throwaway value and print a warning.
const sessionSecret = process.env.SESSION_SECRET;
const secretIsPlaceholder = !sessionSecret || sessionSecret.startsWith('replace-me');
if (secretIsPlaceholder && isProduction) {
  throw new Error('SESSION_SECRET must be set in production. See .env.example.');
}
if (secretIsPlaceholder && !isProduction) {
  console.warn('Warning: SESSION_SECRET is not set, using an insecure dev value. See .env.example.');
}

// 2. Create the app. `app` is the object we attach everything else to.
const app = express();

// 3. Middleware.
//
// When a browser submits an HTML <form>, the fields arrive in the request body
// encoded like `username=cody&password=hunter2`. This middleware parses that
// into a normal object, available as `req.body` in our routes.
app.use(express.urlencoded({ extended: false }));

// Sessions.
//
// How it works, in short (docs/LEARNING.md has the long version):
//   - When someone logs in, the server creates a session: a row in the
//     `sessions` table holding data like { userId: 1, username: "cody" }.
//   - The row is filed under a long random id. The server sends ONLY that id
//     to the browser, inside a cookie called "forest.sid".
//   - The browser automatically sends the cookie back with every request.
//     This middleware reads the id, loads the matching row, and hands us the
//     data as `req.session`. That's how the server "remembers" you.
//
// In production our app will sit behind a proxy that handles HTTPS. This line
// tells Express to trust it, so it knows the request really was HTTPS and is
// willing to send a `secure` cookie (see below).
//
// It also matters for rate limiting (rate-limit.js), which counts attempts per
// IP address: behind a proxy, every request seems to come from the proxy's
// IP. Trusting the proxy makes `req.ip` the visitor's real address instead.
// How many proxies to trust is a setting, not a guess baked into the code:
// TRUST_PROXY=1 means "exactly one proxy sits in front of us, believe what
// it says and nothing further back". Hosts differ (some chain a CDN and a
// load balancer), so after deploying, check /admin/connection: it shows the
// IP address the server thinks you have. If it isn't yours, adjust this.
//
// Why not just trust everything (`true`)? The X-Forwarded-For header that
// proxies use to pass the visitor's IP along can also be typed in by the
// visitor. Trusting too many hops lets someone pick a fake IP for every
// request and dodge the rate limiter.
if (isProduction) {
  const hops = Number(process.env.TRUST_PROXY ?? 1);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 1);
}

app.use(
  session({
    // The cookie's name. The default, "connect.sid", tells attackers which
    // library you use, so pick your own.
    name: 'forest.sid',

    // Used to SIGN the cookie: the session id is sent with a signature that
    // only someone who knows the secret can produce. If anyone edits the
    // cookie, the signature no longer matches and the server ignores it.
    secret: sessionSecret || 'dev-only-insecure-secret',

    // Keep sessions in SQLite (session-store.js) instead of memory, so a
    // server restart doesn't log everybody out.
    store: new SqliteSessionStore(),

    // Don't save a session that nothing was put into. So visitors who never
    // log in get no session row and no cookie.
    saveUninitialized: false,

    // Don't rewrite the session row on every request if nothing changed.
    // (The store's touch() keeps the expiry date fresh instead.)
    resave: false,

    // Reset the cookie's expiry on every request, so "7 days" means
    // "7 days since you last visited", not "7 days since you logged in".
    rolling: true,

    cookie: {
      // httpOnly: JavaScript in the page can't read the cookie
      // (document.cookie won't show it). If an attacker ever got a script
      // onto the page (XSS), they still couldn't steal the session id.
      httpOnly: true,

      // sameSite "lax": the browser only sends the cookie with requests that
      // start on OUR site, plus normal link clicks from other sites. A form
      // on evil.example that secretly POSTs to us arrives without the
      // cookie, which blocks "cross-site request forgery" (CSRF).
      sameSite: 'lax',

      // secure: only send the cookie over HTTPS, never plain HTTP, so it
      // can't be read off the network. localhost uses plain HTTP, so we only
      // turn this on in production.
      secure: isProduction,

      // How long the cookie (and session) lasts: 7 days, in milliseconds.
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// A "health check": the host calls this URL every few seconds to ask "are
// you alive?". If it stops answering, the host restarts the app, and during
// a deploy the host waits for it before sending visitors to the new version.
// We run a tiny query so "ok" also means the database answers.
app.get('/healthz', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    res.type('text').send('ok');
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(503).type('text').send('database unavailable');
  }
});

// Serve every file in /public as-is. So public/login.html is reachable at
// http://localhost:3000/login.html and public/styles.css at /styles.css.
// (The front page "/" is a route in routes/auth.js: it shows the door.)
app.use(express.static(path.join(__dirname, 'public')));

// 4. Routes. Sign-up, login, logout and the members-only page live in
//    routes/auth.js. The admin's invite page lives in routes/admin.js.
app.use(authRoutes);
app.use(adminRoutes);

// Anything that did not match above ends up here: a simple 404 page.
app.use((req, res) => {
  res.status(404).send('Nothing grows here. <a href="/">Go home</a>');
});

// 5. Start the server.
//    Hosts like Render pick the port for you and pass it in as PORT, so we
//    must use it rather than hard-coding 3000.
//
//    First, make sure the database tables exist. That may mean talking to
//    Turso over the network, so we wait for it (top-level `await` isn't
//    allowed in this kind of file, hence the .then()). If the database can't
//    be reached, there's no point starting: log why and exit.
const port = process.env.PORT || 3000;
let server;
initDatabase()
  .then(async () => {
    // Expired sessions are ignored anyway, but sweep them out now and every
    // 15 minutes so they don't pile up. `.unref()` means this timer alone
    // won't keep Node running.
    await pruneExpiredSessions();
    setInterval(() => pruneExpiredSessions().catch(console.error), 15 * 60 * 1000).unref();

    server = app.listen(port, () => {
      console.log(`Forest Sanctuary is listening on port ${port} (${isProduction ? 'production' : 'development'})`);
    });
  })
  .catch((err) => {
    console.error('Could not set up the database. Check DATABASE_URL and DATABASE_AUTH_TOKEN.');
    console.error(err);
    process.exit(1);
  });

// 6. Shut down politely.
//
// When you deploy a new version, the host sends the old one a SIGTERM signal
// ("please stop"). Instead of dying mid-request, we stop accepting new
// connections, let the current requests finish, then close the database
// connection cleanly.
// Ctrl+C on your laptop sends SIGINT, which we handle the same way.
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  if (!server) process.exit(0);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // If something hangs (say, a browser holding a connection open), give up
  // after 10 seconds rather than waiting forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
