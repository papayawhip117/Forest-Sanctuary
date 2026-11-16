# Forest-Sanctuary
Aesthetic forest themed login page+project for learning authentication, database usage, cookies and deployment. 

## Roadmap

1. Sign-up and login with hashed passwords
2. Sessions and cookies, so the server remembers who is logged in
3. **Invite codes, so only invited people can sign up** ← you are here
4. Deployment, so it runs on the internet
5. The forest look and feel

## Running it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install            # download the libraries listed in package.json
cp .env.example .env   # create your own settings file
npm run dev            # start the server; restarts when you save a file
```

Open `.env` and set `SESSION_SECRET` to a long random string. This prints one for you:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Sign-up is invite only, so make the first invite from the command line:

```bash
npm run invite
```

It prints a link like `http://localhost:3000/signup?code=c_iNS_hvXIRK...`. Open it, make your account, and log in. Because yours is the first account, it is the **admin**. You land on **The Sanctuary** (`/sanctuary`), a page only logged-in members can see, with a link to **`/admin/invites`**, where you can make invite links for friends with one click. Visit the home page and come back, or restart the server: you are still logged in. The **Log out** button ends the session.

Already have a database from step 1 or 2? It keeps working: on start-up the server adds the new `is_admin` column and makes your oldest account the admin.

To look inside the database while you learn, the [SQLite CLI](https://sqlite.org/cli.html) works well:

```bash
sqlite3 data/forest.db "SELECT * FROM users;"
```

You will see each password stored as a long `$2b$12$...` string, never the real password. Sessions are in the same file:

```bash
sqlite3 data/forest.db "SELECT * FROM sessions;"
sqlite3 data/forest.db "SELECT * FROM invites;"
```

To start over, stop the server and delete the `data/` folder.

## How the pieces fit together

```
Browser                         Server (Node + Express)                 Disk
───────                         ───────────────────────                 ────
/signup?code=...    ──POST /signup──▶  rate limit (rate-limit.js)
                                        ├─ check invite code ◀───────  invites table
                                        ├─ validate input
                                        ├─ bcrypt.hash(password)
                                        └─ create user + use up invite ▶  data/forest.db
                                           (one transaction)
public/login.html   ──POST /login───▶  rate limit (rate-limit.js)
                                        ├─ db.findUserByUsername() ◀──  data/forest.db
                                        ├─ bcrypt.compare(password, hash)
                                        └─ start a session ──────────▶  sessions table
                    ◀── cookie: forest.sid=<random id> ──
any page            ── cookie: forest.sid ──▶  express-session
                                        └─ load req.session ◀────────  sessions table
```

### The files

| File | What it does |
| --- | --- |
| `server.js` | Starting point. Loads `.env`, creates the Express app, plugs in middleware and routes, and starts listening. |
| `db.js` | Opens the SQLite database, creates the `users` table (adding `is_admin` to older databases), and exposes `createUser`, `findUserByUsername` and `findUserById`. |
| `session-store.js` | Creates the `sessions` table and teaches express-session how to read and write it. |
| `invites.js` | Creates the `invites` table. Makes codes, checks them, and signs someone up while using up their invite. |
| `rate-limit.js` | A small middleware that limits how often one IP address can try something. |
| `routes/auth.js` | The sign-up form (`GET /signup`), `POST /signup`, `POST /login`, `POST /logout`, the `requireLogin` guard, and the members-only `GET /sanctuary` page. |
| `routes/admin.js` | The admin-only invite page, `/admin/invites`, and its `requireAdmin` guard. |
| `html.js` | Small helpers that build HTML pages, and `escapeHtml`. |
| `scripts/create-invite.js` | `npm run invite`: makes an invite from the command line. |
| `public/` | Plain HTML and CSS sent straight to the browser: the home page and the login form. |
| `.env.example` | The settings the app expects. Copy it to `.env` (which git ignores). |

### Express

[Express](https://expressjs.com) is a small web framework. You write *routes* like `router.post('/login', handler)`, meaning "when a POST request arrives for `/login`, run this function". The handler gets `req` (the incoming request) and `res` (what you send back).

*Middleware* are functions that run on every request before your routes. We use three:

- `express.urlencoded()` reads submitted form fields into `req.body`.
- `express-session` reads the session cookie and loads `req.session` (more below).
- `express.static('public')` serves the files in `public/` as they are.

### SQLite and better-sqlite3

SQLite is a full SQL database stored in one file (`data/forest.db`), with no database server to run. `db.js` creates this table the first time the server starts:

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`UNIQUE` makes the database itself reject a second user with the same name, and `COLLATE NOCASE` treats `Cody` and `cody` as the same name.

All queries use **prepared statements** with `?` placeholders. The values are passed separately from the SQL, so input like `'; DROP TABLE users; --` is just stored as a weird username instead of being run. This prevents *SQL injection*.

### Password hashing with bcrypt

We never store passwords. On sign-up, `bcrypt.hash()` turns the password into a hash like:

```
$2b$12$r.7.c2VBFw9NFuWCxegyw.WGWobwBM2GvCDkADTyWgpXdBolFebqO
 │  │  └─ salt (22 chars) + hash (31 chars)
 │  └─ cost: 2^12 rounds of work
 └─ bcrypt version
```

- **One-way:** you can't turn a hash back into the password.
- **Salted:** a random salt is mixed in, so two people with the same password get different hashes, and precomputed "rainbow tables" are useless.
- **Slow on purpose:** the cost (`BCRYPT_ROUNDS` in `.env`) makes each guess take a noticeable fraction of a second, which is nothing for one login but huge for someone trying billions of guesses against a stolen database.

On login, `bcrypt.compare()` reads the salt and cost out of the stored hash, hashes the typed password the same way, and checks whether the results match.

### Small security habits already in the code

- The login error is the same for "no such user" and "wrong password", so the form can't be used to discover which usernames exist.
- Input is validated on the server, not only in the HTML form, because anyone can send a request without a browser.
- Usernames are HTML-escaped before being put on a page, to prevent *cross-site scripting* (XSS).
- Passwords are capped at 72 bytes because bcrypt ignores anything past that.

### Secrets and `.env`

Settings that differ between your laptop and a real server, and secrets like `SESSION_SECRET`, go in `.env`. The `dotenv` library loads it into `process.env` when the server starts. `.env` is in `.gitignore` so it never gets committed. `.env.example` is committed so others can see which settings exist.

## Sessions and cookies

HTTP has no memory. Every request arrives on its own, and nothing in it says "this is the same person who logged in a minute ago". Sessions and cookies fix that.

### Cookies

A **cookie** is a small named value a server asks the browser to keep. The server sends a `Set-Cookie` header, and from then on the browser automatically attaches the cookie to every request to that site. Here is what our login response really sends (you can see it in your browser's dev tools, under Network):

```
Set-Cookie: forest.sid=s%3AaedZLGZuB7p3GiI5zmAzxHs39Hnz7a_E.TzEG77GIW...; Path=/;
            Expires=Mon, 23 Nov 2026 19:28:37 GMT; HttpOnly; SameSite=Lax
```

### Sessions: how the cookie maps to data on the server

The cookie does **not** contain your username or anything about you. It holds just one thing: a long random **session id**. The real data stays on the server, in the `sessions` table, filed under that id:

```
Browser cookie                               sessions table (data/forest.db)
──────────────                               ───────────────────────────────
forest.sid = s:aedZLGZu...7a_E.TzEG77...      sid      aedZLGZuB7p3GiI5zmAzxHs39Hnz7a_E
               └────── id ─────┘ └ signature   sess     {"userId":1,"username":"cody","cookie":{...}}
                       │                       expires  1795462117109
                       └──── looked up by ────▶
```

Step by step:

1. **Logging in.** After the password checks out, `routes/auth.js` calls `req.session.regenerate()` to get a fresh random id, then sets `req.session.userId` and `req.session.username`. express-session saves that object as JSON in a new `sessions` row and sends the browser a `forest.sid` cookie with the id.
2. **Every request after that.** The browser sends the cookie back. express-session checks its signature, takes the id, calls our store's `get(id)`, and puts the saved data back on `req.session`. So in any route, `req.session.userId` tells us who is asking.
3. **Protected pages.** `requireLogin` is a tiny middleware: if `req.session.userId` is set it calls `next()` and the page loads, otherwise it redirects to the login page.
4. **Logging out.** `req.session.destroy()` deletes the row, and `res.clearCookie()` tells the browser to drop its copy. Even if someone had copied the old cookie, its id now points at nothing.

Why not just put `userId=1` in the cookie? Because the browser belongs to the user, and they can edit their cookies. They would change it to `userId=2` and become someone else. A random id is useless to guess, and because the data stays on our server, we can end a session at any time by deleting its row.

### The signature and `SESSION_SECRET`

The part of the cookie after the `.` is a **signature** made from the id and `SESSION_SECRET`. If anyone edits the cookie, the signature no longer matches and the server ignores it. Only someone who knows the secret can make a valid one, which is why the secret lives in `.env`, never in git. In production the server refuses to start without a real one.

### The cookie settings (in `server.js`)

| Setting | What it does | What it protects against |
| --- | --- | --- |
| `httpOnly: true` | JavaScript on the page can't read the cookie (`document.cookie` won't show it). | If an attacker ever gets a script onto the page (XSS), they still can't steal the session id. |
| `sameSite: 'lax'` | The cookie is only sent on requests that start on our own site, or normal link clicks from elsewhere. | A hidden form on another site that POSTs to us arrives without the cookie, which blocks *cross-site request forgery* (CSRF). |
| `secure: true` in production | The cookie only travels over HTTPS. | Someone on the same Wi-Fi reading it off the network. It's off on your laptop because `localhost` uses plain HTTP. |
| `maxAge` + `rolling: true` | The session lasts 7 days since your **last** visit. | Old forgotten sessions staying valid forever. |
| `name: 'forest.sid'` | Our own cookie name instead of the default `connect.sid`. | Advertising which library we use. |
| `saveUninitialized: false` | Visitors who never log in get no session and no cookie. | Filling the table with empty sessions. |

### Two more habits in the code

- **Session fixation.** Login calls `regenerate()` so you always get a brand-new id at the moment you log in. Otherwise an attacker could plant a session id they know in your browser before you log in, then use it afterwards as you.
- **Logout is a POST.** It's a button in a form rather than a link, because browsers and link previews sometimes load links on their own, and that shouldn't log anyone out.

### Why a SQLite session store?

express-session only needs a *store* with four methods: `get`, `set`, `destroy` and `touch`. Its default store keeps sessions in memory, so every restart would log everyone out. `session-store.js` implements those four methods on a SQLite table in about 60 lines, and sweeps out expired rows every 15 minutes.

## Invite codes

Sign-up only works with an invite link like `/signup?code=c_iNS_hvXIRKN359Is-IeyuArzevpYYP-USMlpgyqd0`. Each code works **once**, for **7 days** (`INVITE_TTL_DAYS` in `.env`).

### Making a code

`createInvite()` in `invites.js` asks the operating system for 32 random bytes with `crypto.randomBytes`, and writes them as 43 URL-safe characters. 32 bytes is 256 bits: there are more possible codes than atoms in the universe, so nobody will ever guess one. (`Math.random()` is never used for this: it is predictable.)

### Storing a hash, not the code

The `invites` table stores a **SHA-256 hash** of each code, never the code itself, the same idea as passwords:

```
invites
id  code_hash          created_by  created_at           expires_at           used_by  used_at
1   9f2c1e...(64 hex)  NULL        2026-11-16 19:38:38  2026-11-23 19:38:38  1        2026-11-16 19:39:02
2   41ab07...          1           2026-11-16 19:40:11  2026-11-23 19:40:11  NULL     NULL
```

When someone signs up, we hash the code they bring and look for a row with that hash. If someone copied the database file, the hashes would be useless to them.

Why SHA-256 and not bcrypt? bcrypt is slow on purpose because *people* pick short, guessable passwords. These codes are long and random, so a fast hash is already safe. And bcrypt salts each hash randomly, so the same code would hash differently every time and we couldn't look it up with `WHERE code_hash = ?`.

The downside: the server can't show you an old link again, because it never kept it. The admin page shows each new link **once**, like an API token on GitHub.

### Using a code exactly once: transactions

A sign-up has to do two things: create the user, and mark the invite as used by them. If only one happened, we'd have either an account with a still-valid invite (reusable!) or a used-up invite with no account. So `signUpWithInvite()` wraps both in a **transaction** with `db.transaction()`: either everything inside it happens, or, if anything throws (like the username being taken), SQLite undoes all of it. That's also why trying a taken username doesn't burn your invite.

The "mark as used" query is `UPDATE invites SET used_by = ? WHERE id = ? AND used_by IS NULL`. If the invite was somehow used a moment earlier, it changes 0 rows, the code throws, and the transaction rolls back.

### Who can make invites: admins

There's a chicken-and-egg problem: you need an invite to make an account, and an account to make invites. Two pieces solve it:

1. **`npm run invite`** makes an invite straight from the command line. Anyone who can run commands on the server could open the database anyway, so that's trusted.
2. **The first account becomes the admin** (`is_admin = 1` in `users`). Admins see a link on the Sanctuary to `/admin/invites`, which has a **Create invite link** button and a table of every invite: waiting, used (and by whom), or expired.

The admin page is guarded by two middlewares in a row: `requireLogin` ("who are you?", called *authentication*) and then `requireAdmin` ("are you allowed?", called *authorization*). The admin check reads `is_admin` from the database on each request rather than saving it in the session, so taking someone's admin away works immediately.

### Two more patterns on the admin page

- **Post/Redirect/Get.** Clicking the button POSTs to `/admin/invites`, which makes the invite and *redirects* to the GET page. If it showed the link directly, refreshing would resubmit the form and silently make another invite.
- **Flash messages.** So how does the GET page know the new link? The POST puts it in `req.session.newInviteLink`, and the GET page shows it and deletes it straight away. A one-time message carried in the session like this is called a *flash*.

## Rate limiting

`rate-limit.js` limits how many times one IP address can try to **log in (10 per 15 minutes)** and **sign up (10 per hour)**. Past that, the server answers `429 Too Many Requests` with a `Retry-After` header saying how many seconds to wait.

It counts with a "fixed window": for each IP it remembers a count and when the window started, and starts over when the window ends. This slows down anyone running a script to guess passwords. bcrypt already makes each guess slow and invite codes can't be guessed, but this is a cheap extra layer, and it stops one visitor keeping the server busy hashing passwords.

Things to know:

- The counts live in memory, so restarting the server resets them. (Handy if you lock yourself out while testing!)
- Once deployed behind a proxy, `trust proxy` in `server.js` is what makes `req.ip` the visitor's real address rather than the proxy's.
- Real projects usually use the [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit) package, and a shared store like Redis when there's more than one server. Ours is the same idea in about 40 lines.

## What's missing (on purpose)

It only runs on your laptop. Putting it on the internet is step 4, **deployment**.
