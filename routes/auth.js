// routes/auth.js
// -----------------------------------------------------------------------------
// Sign-up, login, logout, and a page only logged-in users can see.
//
// A "router" is a mini Express app holding a group of related routes. server.js
// plugs it in with `app.use(authRoutes)`.
//
// Logging in puts your user id into `req.session`. The session middleware in
// server.js saves that to the database and gives your browser a cookie, so on
// every later request `req.session.userId` tells us who you are.
// -----------------------------------------------------------------------------

const express = require('express');
const bcrypt = require('bcrypt');
const { createUser, findUserByUsername } = require('../db');

const router = express.Router();

// How expensive each hash is. See .env.example for what this means.
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

// Basic rules for what we accept. Always validate on the server, even if the
// HTML form also checks: anyone can send a request without using your form.
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;
// bcrypt only looks at the first 72 bytes of a password, so we cap it there
// rather than silently ignoring the rest.
const MAX_PASSWORD_BYTES = 72;

// -----------------------------------------------------------------------------
// POST /signup  (the sign-up form in public/signup.html sends its data here)
// -----------------------------------------------------------------------------
// `async` lets us use `await` for bcrypt, which is deliberately slow and runs
// in the background so the server can keep handling other requests meanwhile.
router.post('/signup', async (req, res) => {
  // `?? ''` means "use an empty string if the field is missing".
  const username = String(req.body.username ?? '').trim();
  const password = String(req.body.password ?? '');

  // --- Validate the input ---------------------------------------------------
  if (!USERNAME_PATTERN.test(username)) {
    return res
      .status(400)
      .send(page('Sign up', 'Usernames are 3 to 30 letters, numbers or underscores.', '/signup.html'));
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .send(page('Sign up', `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`, '/signup.html'));
  }
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    return res
      .status(400)
      .send(page('Sign up', 'That password is too long (72 bytes max).', '/signup.html'));
  }

  // --- Hash the password ----------------------------------------------------
  // bcrypt.hash() turns "hunter2" into something like
  //   $2b$12$Qe1pV...  (60 characters)
  // That string contains the algorithm version, the cost, a random "salt", and
  // the hash itself. The random salt means two people with the same password
  // still get completely different hashes.
  // Hashing is ONE-WAY: there is no way to turn the hash back into the password.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // --- Save the user --------------------------------------------------------
  try {
    createUser(username, passwordHash);
  } catch (err) {
    // The UNIQUE rule on the username column makes SQLite throw this error
    // when the name is taken. Any other error is unexpected, so re-throw it.
    // (Express 5 catches errors thrown in async routes and shows a 500 page.)
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res
        .status(409)
        .send(page('Sign up', 'That username is already taken.', '/signup.html'));
    }
    throw err;
  }

  res
    .status(201)
    .send(page('Welcome', `Account created for ${escapeHtml(username)}. You can log in now.`, '/login.html', 'Log in'));
});

// -----------------------------------------------------------------------------
// POST /login  (the login form in public/login.html sends its data here)
// -----------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  const username = String(req.body.username ?? '').trim();
  const password = String(req.body.password ?? '');

  // Look the user up. `user` is undefined if nobody has that name.
  const user = findUserByUsername(username);

  // bcrypt.compare() reads the salt and cost out of the stored hash, hashes
  // the password that was just typed the same way, and checks if they match.
  //
  // Notice we give the SAME error for "no such user" and "wrong password".
  // If we said "no such user", an attacker could use the login form to find
  // out which usernames exist.
  const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!passwordMatches) {
    return res
      .status(401)
      .send(page('Log in', 'Wrong username or password.', '/login.html', 'Try again'));
  }

  // --- Start a session -----------------------------------------------------
  // regenerate() throws away any session the browser already had and creates
  // a brand new one with a fresh random id. This prevents "session fixation":
  // an attack where someone plants a session id they know in your browser,
  // waits for you to log in, and then uses that same id as you.
  await regenerateSession(req);

  // Whatever we put on req.session gets saved in the sessions table. Store as
  // little as possible: the id to find the user, and the name for greetings.
  req.session.userId = user.id;
  req.session.username = user.username;

  // Redirect instead of sending a page. The browser makes a fresh GET request
  // for /sanctuary, carrying its new cookie. (Redirecting after a POST also
  // means refreshing the page won't resubmit the login form.)
  res.redirect('/sanctuary');
});

// -----------------------------------------------------------------------------
// POST /logout
// -----------------------------------------------------------------------------
// Logout is a POST (a form with a button), not a plain link. Browsers and
// link previewers sometimes load links in advance, and you don't want that to
// log people out. Also, our sameSite cookie setting means other websites can't
// trigger this POST on your behalf.
router.post('/logout', (req, res, next) => {
  // destroy() deletes the session row from the database. Even if someone had
  // copied the old cookie, the id now points at nothing.
  req.session.destroy((err) => {
    if (err) return next(err);
    // Tell the browser to delete its copy of the cookie too. The name must
    // match the `name` option in server.js.
    res.clearCookie('forest.sid');
    res.redirect('/');
  });
});

// -----------------------------------------------------------------------------
// requireLogin: a small middleware that guards pages.
// -----------------------------------------------------------------------------
// Middleware is any function shaped (req, res, next). Calling next() means
// "carry on to the next handler". Not calling it means we answer the request
// ourselves, here with a redirect to the login page.
function requireLogin(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login.html');
}

// -----------------------------------------------------------------------------
// GET /sanctuary  (members only)
// -----------------------------------------------------------------------------
// requireLogin runs first. Only if it calls next() does this handler run, so
// in here we know someone is logged in.
router.get('/sanctuary', requireLogin, (req, res) => {
  const name = escapeHtml(req.session.username);
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>The Sanctuary · Forest Sanctuary</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="card">
    <h1>The Sanctuary</h1>
    <p>Welcome in, ${name}. Only logged-in members can see this page.</p>
    <p>Try opening <a href="/">the home page</a> and coming back: you stay logged in,
       because your browser sends its session cookie with every request.</p>
    <form method="post" action="/logout">
      <button type="submit">Log out</button>
    </form>
  </main>
</body>
</html>`);
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// express-session's regenerate() uses an old-style callback. Wrapping it in a
// Promise lets us `await` it, and if it fails, Express 5 shows the error page.
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

// Builds a tiny HTML page to show a message with a link onward. Later steps
// can swap this for proper templates.
function page(title, message, linkHref, linkText = 'Go back') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Forest Sanctuary</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="${linkHref}">${linkText}</a></p>
  </main>
</body>
</html>`;
}

// Anything a user typed must be "escaped" before we put it into HTML.
// Otherwise someone could sign up as `<script>...</script>` and that script
// would run in other people's browsers (an attack called XSS).
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

module.exports = router;
