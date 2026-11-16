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
const SqliteSessionStore = require('./session-store');
const authRoutes = require('./routes/auth');

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
// How it works, in short (the README has the long version):
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
if (isProduction) {
  app.set('trust proxy', 1);
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

// Serve every file in /public as-is. So public/login.html is reachable at
// http://localhost:3000/login.html and public/styles.css at /styles.css.
// Visiting "/" serves public/index.html automatically.
app.use(express.static(path.join(__dirname, 'public')));

// 4. Routes. Sign-up, login, logout and the members-only page all live in
//    routes/auth.js.
app.use(authRoutes);

// Anything that did not match above ends up here: a simple 404 page.
app.use((req, res) => {
  res.status(404).send('Nothing grows here. <a href="/">Go home</a>');
});

// 5. Start the server.
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Forest Sanctuary is listening on http://localhost:${port}`);
});
