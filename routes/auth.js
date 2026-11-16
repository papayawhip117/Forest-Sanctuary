// routes/auth.js
// -----------------------------------------------------------------------------
// Sign-up (invite only), login, logout, and a page only logged-in users can
// see.
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
const { findUserByUsername, findUserById } = require('../db');
const { isInviteUsable, signUpWithInvite } = require('../invites');
const rateLimit = require('../rate-limit');
const { layout, page, escapeHtml } = require('../html');

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
// Rate limits (see rate-limit.js)
// -----------------------------------------------------------------------------
// Login: 10 tries per 15 minutes from one IP address. Plenty for a person who
// mistyped, far too few for a script guessing passwords.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: (minutes) =>
    page('Log in', `Too many login attempts. Please wait ${minutes} minute(s) and try again.`, '/login.html'),
});

// Sign-up: 10 tries per hour from one IP address.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: (minutes) =>
    page('Sign up', `Too many sign-up attempts. Please wait ${minutes} minute(s) and try again.`, '/'),
});

// -----------------------------------------------------------------------------
// GET /signup?code=...  (the sign-up form)
// -----------------------------------------------------------------------------
// Invite links look like http://localhost:3000/signup?code=AbC123...
// The part after `?` is the "query string". Express parses it for us into
// `req.query`, so `req.query.code` is the invite code.
//
// This page used to be a static file (public/signup.html). It's built here now
// because it needs the code from the link, and only the server can check
// whether that code is any good before showing the form.
router.get('/signup', (req, res) => {
  const code = String(req.query.code ?? '');

  if (!isInviteUsable(code)) {
    return res.status(403).send(
      layout(
        'Invite only',
        `    <p>Forest Sanctuary is invite only. You need a valid invite link to sign up.</p>
    <p>${code ? 'That invite link is wrong, already used, or expired. Ask for a new one.' : 'Ask a member for an invite link.'}</p>
    <p>Already have an account? <a href="/login.html">Log in</a></p>`
      )
    );
  }

  res.send(signupForm(code));
});

// -----------------------------------------------------------------------------
// POST /signup  (the sign-up form above sends its data here)
// -----------------------------------------------------------------------------
// `async` lets us use `await` for bcrypt, which is deliberately slow and runs
// in the background so the server can keep handling other requests meanwhile.
//
// `signupLimiter` runs first and stops the request if this IP is over its limit.
router.post('/signup', signupLimiter, async (req, res) => {
  // `?? ''` means "use an empty string if the field is missing".
  const username = String(req.body.username ?? '').trim();
  const password = String(req.body.password ?? '');
  // The form carries the invite code along in a hidden field.
  const code = String(req.body.code ?? '');

  // Where "Go back" links point, so the person doesn't lose their invite.
  // encodeURIComponent makes the code safe to put inside a URL.
  const backToForm = `/signup?code=${encodeURIComponent(code)}`;

  // --- Check the invite first ----------------------------------------------
  // This is cheap, so do it before the slow password hashing. No valid invite,
  // no account, whatever else was sent.
  if (!isInviteUsable(code)) {
    return res
      .status(403)
      .send(page('Sign up', 'That invite is wrong, already used, or expired.', '/'));
  }

  // --- Validate the input ---------------------------------------------------
  if (!USERNAME_PATTERN.test(username)) {
    return res
      .status(400)
      .send(page('Sign up', 'Usernames are 3 to 30 letters, numbers or underscores.', backToForm));
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .send(page('Sign up', `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`, backToForm));
  }
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    return res
      .status(400)
      .send(page('Sign up', 'That password is too long (72 bytes max).', backToForm));
  }

  // --- Hash the password ----------------------------------------------------
  // bcrypt.hash() turns "hunter2" into something like
  //   $2b$12$Qe1pV...  (60 characters)
  // That string contains the algorithm version, the cost, a random "salt", and
  // the hash itself. The random salt means two people with the same password
  // still get completely different hashes.
  // Hashing is ONE-WAY: there is no way to turn the hash back into the password.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // --- Save the user and use up the invite ----------------------------------
  // signUpWithInvite (in invites.js) does both inside one database
  // transaction, so they either both happen or neither does.
  let userId;
  try {
    userId = signUpWithInvite(code, username, passwordHash);
  } catch (err) {
    // The UNIQUE rule on the username column makes SQLite throw this error
    // when the name is taken. Any other error is unexpected, so re-throw it.
    // (Express 5 catches errors thrown in async routes and shows a 500 page.)
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res
        .status(409)
        .send(page('Sign up', 'That username is already taken.', backToForm));
    }
    throw err;
  }

  // The invite was checked above, but it could have been used or expired in
  // the second or so we spent hashing. The transaction checks again.
  if (!userId) {
    return res
      .status(403)
      .send(page('Sign up', 'That invite is wrong, already used, or expired.', '/'));
  }

  res
    .status(201)
    .send(page('Welcome', `Account created for ${escapeHtml(username)}. You can log in now.`, '/login.html', 'Log in'));
});

// -----------------------------------------------------------------------------
// POST /login  (the login form in public/login.html sends its data here)
// -----------------------------------------------------------------------------
router.post('/login', loginLimiter, async (req, res) => {
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

  // Admins get a link to the invite page. We look the user up in the database
  // instead of trusting something saved in the session, so if you ever remove
  // someone's admin flag it takes effect right away.
  const user = findUserById(req.session.userId);
  const adminLink = user && user.is_admin
    ? '    <p>You are an admin: <a href="/admin/invites">create invite links</a>.</p>\n'
    : '';

  res.send(
    layout(
      'The Sanctuary',
      `    <p>Welcome in, ${name}. Only logged-in members can see this page.</p>
    <p>Try opening <a href="/">the home page</a> and coming back: you stay logged in,
       because your browser sends its session cookie with every request.</p>
${adminLink}    <form method="post" action="/logout">
      <button type="submit">Log out</button>
    </form>`
    )
  );
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

// The sign-up form. The invite code rides along in a hidden <input>, so it is
// sent with the username and password when the form is submitted.
function signupForm(code) {
  return layout(
    'Sign up',
    `    <p>You've been invited. Pick a username and password.</p>

    <!--
      method="post" sends the fields in the request body (not the URL, where
      they would show up in browser history and server logs).
      action="/signup" is the POST route above.
      Each input's \`name\` becomes a key in req.body on the server.
    -->
    <form method="post" action="/signup">
      <input type="hidden" name="code" value="${escapeHtml(code)}">

      <label for="username">Username</label>
      <!-- These checks (required, pattern, minlength) are just for convenience.
           The server checks again, because anyone can skip the browser. -->
      <input id="username" name="username" required
             pattern="[A-Za-z0-9_]{3,30}" autocomplete="username"
             title="3 to 30 letters, numbers or underscores">

      <label for="password">Password</label>
      <!-- autocomplete="new-password" tells password managers to suggest one. -->
      <input id="password" name="password" type="password" required
             minlength="8" maxlength="72" autocomplete="new-password">

      <button type="submit">Create account</button>
    </form>

    <p>Already have an account? <a href="/login.html">Log in</a></p>`
  );
}

module.exports = { router, requireLogin };
