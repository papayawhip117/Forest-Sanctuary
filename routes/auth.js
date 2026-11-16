// routes/auth.js
// -----------------------------------------------------------------------------
// Sign-up and login.
//
// A "router" is a mini Express app holding a group of related routes. server.js
// plugs it in with `app.use(authRoutes)`.
//
// Note: right now login only CHECKS your password and shows a message. The
// server forgets you immediately afterwards. Remembering who is logged in
// between requests is what sessions and cookies are for, which is the next
// step of the project.
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

  res.send(page('Welcome back', `Hello, ${escapeHtml(user.username)}. Your password checked out.`, '/', 'Home'));
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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
