# Forest-Sanctuary
Aesthetic forest themed login page+project for learning authentication, database usage, cookies and deployment. 

## Roadmap

1. Sign-up and login with hashed passwords
2. Sessions and cookies, so the server remembers who is logged in
3. Invite codes, so only invited people can sign up
4. Deployment, so it runs on the internet
5. **The forest look and feel: pixel art** ← you are here

## Running it

You need [Node.js](https://nodejs.org) 22 or newer (`npm run invite:prod` uses Node's `--env-file` option).

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

It prints a link like `http://localhost:3000/signup?code=c_iNS_hvXIRK...`. Open it, make your account, and log in. Because yours is the first account, it is the **admin**. You land on **The Sanctuary** (`/sanctuary`), a page only logged-in members can see, with a link to **`/admin/invites`**, where you can make invite links for friends with one click. Open the front page (`/`) again, or restart the server: you are still logged in, so it sends you straight back into the Sanctuary instead of showing the door. The **Log out** button ends the session.

Already have a database from an earlier step? It keeps working: on start-up the server adds the `is_admin` column if it's missing and makes your oldest account the admin. An older `.env` that sets `DATABASE_PATH` instead of `DATABASE_URL` works too.

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
Browser                         Server (Node + Express)                 Database
───────                         ───────────────────────                 ────────
/signup?code=...    ──POST /signup──▶  rate limit (rate-limit.js)
                                        ├─ check invite code ◀───────  invites table
                                        ├─ validate input
                                        ├─ bcrypt.hash(password)
                                        └─ create user + use up invite ▶  users + invites
                                           (one transaction)
public/login.html   ──POST /login───▶  rate limit (rate-limit.js)
                                        ├─ db.findUserByUsername() ◀──  users table
                                        ├─ bcrypt.compare(password, hash)
                                        └─ start a session ──────────▶  sessions table
                    ◀── cookie: forest.sid=<random id> ──
any page            ── cookie: forest.sid ──▶  express-session
                                        └─ load req.session ◀────────  sessions table
```

### The files

| File | What it does |
| --- | --- |
| `server.js` | Starting point. Loads `.env`, creates the Express app, plugs in middleware and routes, starts listening, and shuts down cleanly. Also has the `/healthz` health check. |
| `db.js` | Connects to the database (a local SQLite file, or Turso in production), creates all the tables, and exposes `createUser`, `findUserByUsername` and `findUserById`. |
| `session-store.js` | Teaches express-session how to read and write the `sessions` table. |
| `invites.js` | Makes invite codes, checks them, and signs someone up while using up their invite. |
| `rate-limit.js` | A small middleware that limits how often one IP address can try something. |
| `routes/auth.js` | The front page (`GET /`: the door, or straight to the Sanctuary if you're logged in), the sign-up form (`GET /signup`), `POST /signup`, `POST /login`, `POST /logout`, the `requireLogin` guard, and the members-only `GET /sanctuary` page. |
| `routes/admin.js` | The admin-only invite page, `/admin/invites`, the `/admin/connection` deployment check, and their `requireAdmin` guard. |
| `html.js` | Small helpers that build HTML pages, and `escapeHtml`. |
| `scripts/create-invite.js` | `npm run invite` / `npm run invite:prod`: makes an invite from the command line. |
| `public/` | Plain HTML and CSS sent straight to the browser: the login door (also the front page, `/`) and the stylesheet. |
| `public/art/` | The pixel art, drawn by small JavaScript files: `pixel.js` (shared helpers), `door.js` (login and sign-up) and `sanctuary.js` (the garden). See "The pixel art" below. |
| `.env.example` | The settings the app expects. Copy it to `.env` (which git ignores). |
| `render.yaml` | The Render Blueprint: how to build and run the deployed site, and which settings it needs. |
| `.node-version` | Which Node.js version Render should use (22). |

### Express

[Express](https://expressjs.com) is a small web framework. You write *routes* like `router.post('/login', handler)`, meaning "when a POST request arrives for `/login`, run this function". The handler gets `req` (the incoming request) and `res` (what you send back).

*Middleware* are functions that run on every request before your routes. We use three:

- `express.urlencoded()` reads submitted form fields into `req.body`.
- `express-session` reads the session cookie and loads `req.session` (more below).
- `express.static('public')` serves the files in `public/` as they are.

### SQLite, libSQL and Turso

SQLite is a full SQL database stored in one file (`data/forest.db`), with no database server to run. We talk to it with [`@libsql/client`](https://docs.turso.tech/sdk/ts/reference), which can open that local file *or* connect over the internet to a [Turso](https://turso.tech) database (Turso runs libSQL, an open-source fork of SQLite). Locally we use the file; the deployed site uses Turso, because free hosts throw away files (see [Deploying to Render](#deploying-to-render)). The SQL is identical either way.

Because a query might travel across the internet, every database call returns a **Promise** that we `await`. That's why the routes are `async` functions.

`db.js` creates the tables the first time the server starts (`initDatabase()`). The users table:

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`UNIQUE` makes the database itself reject a second user with the same name, and `COLLATE NOCASE` treats `Cody` and `cody` as the same name.

All queries use `?` placeholders, passed as `db.execute({ sql, args })`. The values are passed separately from the SQL, so input like `'; DROP TABLE users; --` is just stored as a weird username instead of being run. This prevents *SQL injection*.

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

A sign-up has to do two things: create the user, and mark the invite as used by them. If only one happened, we'd have either an account with a still-valid invite (reusable!) or a used-up invite with no account. So `signUpWithInvite()` wraps both in a **transaction** with `db.transaction('write')`: either everything inside it is committed, or, if anything throws (like the username being taken), it's rolled back and the database undoes all of it. The slow bcrypt hashing happens *before* the transaction starts, so the database is locked for as short a time as possible. That's also why trying a taken username doesn't burn your invite.

The "mark as used" query is `UPDATE invites SET used_by = ? WHERE id = ? AND used_by IS NULL`. If the invite was somehow used a moment earlier, it changes 0 rows, the code throws, and the transaction rolls back.

### Who can make invites: admins

There's a chicken-and-egg problem: you need an invite to make an account, and an account to make invites. Two pieces solve it:

1. **`npm run invite`** makes an invite straight from the command line (`npm run invite:prod` for the deployed site). Anyone holding the database credentials could edit the tables directly anyway, so that's trusted.
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
- Once deployed behind a proxy, `trust proxy` in `server.js` is what makes `req.ip` the visitor's real address rather than the proxy's. The "Checking the proxy setting" part of [Deploying to Render](#deploying-to-render) shows how to confirm it.
- Real projects usually use the [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit) package, and a shared store like Redis when there's more than one server. Ours is the same idea in about 40 lines.

## Deploying to Render

So far the site only runs on your laptop at `http://localhost:3000`. Deploying puts it on a server with a public `https://` address, so friends and family can sign up and log in from their own phones and computers. The whole setup costs **$0** and needs no credit card:

- **[Render](https://render.com)** (free web service) runs the Node app, building it straight from this GitHub repo.
- **[Turso](https://turso.tech)** (free plan) holds the database.

### Why two services?

Our whole database used to be one file on the server's disk. On your laptop that's fine. But Render's free plan has a **throwaway filesystem**: every deploy, every restart and every time the app goes to sleep, the server starts again from a fresh copy of your code, and any file the app wrote is gone. With a database file, every account, invite and session would vanish each time.

So in production the data lives somewhere else: a Turso database. Turso runs **libSQL**, an open-source fork of SQLite, on its own servers. It speaks the same SQL as the local file, so the code barely changed: `db.js` connects to a local file when `DATABASE_URL` starts with `file:`, and to Turso when it starts with `libsql://`. This split, where the app server can be thrown away and the data lives in a separate database, is how most real web apps are built.

### What "free" costs you

- **The site sleeps.** Render puts a free web service to sleep after **15 minutes** without visitors. The next visitor waits **about a minute** while it wakes up (a "cold start"); after that it's fast again. Nothing is lost while it sleeps, because the data is in Turso. If a friend says "it's not loading", tell them to give it a minute.
- **750 free hours a month** on Render. One always-on service uses at most 744, so a single site fits.
- **Turso's free plan** allows 100 databases, 5 GB of storage and millions of reads and writes a month. Forest Sanctuary will use a tiny fraction of that.
- **Render can restart a free service at any time.** Same as sleeping: harmless, the data is in Turso.

If any screen in either dashboard asks for a credit card, you've picked a paid option by mistake: go back and choose the free one.

### What changes when the app runs on a server

The code reads everything that differs between your laptop and the server from **environment variables**: on your laptop they come from `.env`, on Render you set them in the dashboard (or `render.yaml` sets them for you).

| Variable | On your laptop | On Render | What it does |
| --- | --- | --- | --- |
| `PORT` | 3000 (from `.env`) | Set by Render | The port the server listens on. Render picks it and routes your public address to it. |
| `NODE_ENV` | unset | `production` | Turns on secure cookies and `trust proxy`, and refuses to start without a real `SESSION_SECRET`. |
| `SESSION_SECRET` | from `.env` | Generated by Render | Signs session cookies. Render makes a random one once and keeps it. |
| `DATABASE_URL` | `file:./data/forest.db` | `libsql://….turso.io` | Where the database is: a local file, or your Turso database. |
| `DATABASE_AUTH_TOKEN` | unset | your Turso token | Turso's password. Without it Turso refuses the connection. |
| `TRUST_PROXY` | unset | `1` | How many proxies to believe about the visitor's IP. See "Checking the proxy setting". |

### What `render.yaml` is

`render.yaml` is a **Blueprint**: the service's settings written as a file in the repo, instead of clicked into a dashboard. It's an example of "infrastructure as code": the setup is versioned with git, reviewed in pull requests, and can be recreated from scratch. Open it; every line is commented. In short it tells Render to:

- use the **free** plan
- run `npm ci --omit=dev` to install exactly the versions in `package-lock.json`, then `npm start`
- check `/healthz` to know the app is up (it's in `server.js`)
- set the environment variables in the table above

The two Turso values are marked `sync: false`, which means they are **not** in the file. This repo is public, and anyone holding your Turso token could read and change your database, so Render asks you to paste them in instead.

`.node-version` tells Render to use Node 22, the same as on your laptop.

### Step 1: create the Turso database

1. Go to [turso.tech](https://turso.tech) and sign up (signing in with GitHub is easiest). Choose the **Free** plan.
2. In the Turso dashboard, create a **database**. Call it `forest-sanctuary` and pick the location closest to where you'll run the Render service (for example a US region if you pick Render's Oregon or Ohio). Closer means faster queries.
3. Open the database and find its **URL**. It looks like `libsql://forest-sanctuary-yourname.turso.io`. Copy it somewhere handy.
4. Create a **token** for the database (look for "Create Token" or "Generate Token" on the database page). Give it read and write access, and no expiry (or a long one; if it expires, the site stops being able to reach its data). Copy it. **Treat it like a password**: don't commit it or paste it in a chat.

Prefer the terminal? With the [Turso CLI](https://docs.turso.tech/cli) installed (`brew install tursodatabase/tap/turso` on a Mac), the same steps are:

```bash
turso auth signup                         # or `turso auth login`
turso db create forest-sanctuary          # make the database
turso db show forest-sanctuary --url      # print its libsql:// URL
turso db tokens create forest-sanctuary   # print a token for it
```

You don't need to create any tables: the app does that itself the first time it connects.

### Step 2: deploy to Render

1. **Merge this pull request**, so `render.yaml` is on the `main` branch.
2. **Sign up** at [render.com](https://render.com) with GitHub.
3. **New Blueprint.** In the Render dashboard, click **New** → **Blueprint**. If Render asks, connect your GitHub account and give it access to the `Forest-Sanctuary` repository.
4. **Pick the repo.** Choose `papayawhip117/Forest-Sanctuary`, branch `main`. Give the Blueprint a name (anything, such as `forest-sanctuary`).
5. **Paste the secrets.** Render reads `render.yaml`, lists one free web service called `forest-sanctuary`, and asks for the two values it doesn't know: paste your Turso URL into `DATABASE_URL` and your token into `DATABASE_AUTH_TOKEN`.
6. **Apply.** Click **Apply** (or **Deploy Blueprint**).
7. **Watch the first deploy.** Open the `forest-sanctuary` service and its **Logs** tab. You'll see `npm ci` install everything, then:

   ```
   Forest Sanctuary is listening on port 10000 (production)
   ```

   If you see `Could not set up the database` instead, the URL or token is wrong: fix them under the service's **Environment** tab, and Render restarts the app.
8. **Find your address.** When the status says **Live**, the address is near the top of the service page, something like `https://forest-sanctuary.onrender.com` (Render adds a few random characters if the name is taken). Open it: you should see the overgrown door, served over https.

### Step 3: make the first admin invite

The production database starts empty, and sign-up needs an invite: the same chicken and egg as on your laptop, solved the same way, with the invite script. On a paid server you'd run it in Render's Shell, but the free plan has no Shell. That's fine, because the script doesn't need to run *on* the server: it only needs to reach the **database**. So you run it on your laptop, pointed at Turso.

1. In the project folder on your laptop, create a file called **`.env.production`** with these three lines (your own values):

   ```
   DATABASE_URL=libsql://forest-sanctuary-yourname.turso.io
   DATABASE_AUTH_TOKEN=your-turso-token
   APP_URL=https://forest-sanctuary.onrender.com
   ```

   `.gitignore` already ignores every `.env.*` file except `.env.example`, so this one will never be committed. (Check with `git status`: it shouldn't be listed.)
2. Run:

   ```bash
   npm run invite:prod
   ```

   This is `npm run invite` with `node --env-file=.env.production` in front, which loads those three settings first. It prints a link like `https://forest-sanctuary.onrender.com/signup?code=…`.
3. Open the link **yourself** and sign up. The first account becomes the admin, so do this before you share anything with anyone else.
4. Log in. The Sanctuary page now links to **create invite links**; from here on you make invites in the browser.

If an invite ever reaches the wrong person before you use it, make a new one; it expires after 7 days anyway.

### Checking the proxy setting

On Render, visitors don't talk to the app directly. Their request first goes through Render's proxies, which handle https and then pass the request on. Two things depend on the app understanding that:

- **Secure cookies.** The proxy tells the app "this came in over https" with a header. If the app doesn't believe it, it refuses to send the `Secure` session cookie, and logins silently don't stick.
- **The rate limiter**, which counts attempts per IP address. The proxy passes the visitor's IP in the `X-Forwarded-For` header, adding each hop's address to the end of a list. `TRUST_PROXY=1` tells Express to believe the last entry and nothing before it. Believe too few hops and every visitor appears to have the proxy's IP, so one person's typos could lock everyone out. Believe too many and a visitor can type a fake IP into the header and dodge the limit.

Render doesn't document how many proxy hops it uses, so check it rather than guessing:

1. Logged in as the admin, go to **Invites** → **Connection check** (`/admin/connection`).
2. Compare **Your IP** with your real public IP (search "what is my IP" in another tab). **Protocol** should say `https`.
3. If **Your IP** is wrong, look at **Raw X-Forwarded-For header**. Count the entries from the right until you reach your real IP: if it's 2nd from the right, set `TRUST_PROXY` to `2`; if 3rd, `3`. Change the value in `render.yaml`, commit and push, and Render redeploys with it. Check the page again.

### Deploying changes later

Every push to `main` deploys automatically: Render pulls the new code, runs the build, and swaps the app over. The data is in Turso, so accounts, invites and sessions carry over and nobody gets logged out.

A few other things to know:

- **Logs** tab on Render: everything `console.log` and `console.error` print, live. The first place to look when something breaks.
- **Looking inside the production database**: the Turso dashboard has a SQL editor, or use `turso db shell forest-sanctuary`. Try `SELECT id, username, is_admin FROM users;`.
- **Environment** tab on Render: where the variables live. Values written in `render.yaml` get reset to what the file says when the Blueprint syncs, so change those in the file instead. The two Turso values aren't in the file, so they're edited here.
- **`SESSION_SECRET`**: never needs touching. Changing it logs everyone out (every existing cookie's signature stops matching).
- **Shutting down politely**: when Render stops the app (a deploy, or going to sleep) it sends a `SIGTERM` signal. `server.js` listens for it, finishes the requests in progress and closes the database connection before exiting.

### Other free options we considered

- **Cloudflare Workers + D1** is also free and never sleeps. But Workers aren't a normal Node server: Express, bcrypt and express-session would all need replacing, so it's a rebuild rather than a deployment step. It's a good future project.
- **Keeping SQLite on the server's disk** needs a persistent disk, which no mainstream host offers for free.

## The pixel art

There are no image files. Every picture is **drawn by code** onto a tiny `<canvas>`, then CSS stretches it to fill the screen.

### The two tricks

1. **Draw small.** The door is only 72 x 108 pixels. The garden is about 110 pixels across the short side of your screen. All drawing uses whole-number coordinates, so each call colors whole pixels.
2. **Scale up without blur.** In `styles.css`, `image-rendering: pixelated` tells the browser to blow each pixel up into a crisp square block. Without it, the browser would smooth the tiny canvas into mush.

### The toolkit (`public/art/pixel.js`)

| Helper | What it draws |
| --- | --- |
| `rect`, `px`, `ellipse` | Rectangles, single pixels, blocky ovals. |
| `blob` | A leafy clump (bushes, tree crowns, ivy): lots of small round puffs, each in a dark, mid and light shade, so they look lit from above. |
| `glow` | Light (the flame, the windows): see-through circles stacked with the `lighter` blend mode, so their colors add up like real light. |
| `sprite` | A small drawing written as text, one string per row, one letter per pixel. The bunny is drawn this way. |
| `makeRandom` | A *seeded* random number generator: the same seed gives the same numbers, so the leaves and flowers land in the same places every visit. Change a seed to rearrange them. |
| `animate` | Calls a drawing function about 12 times a second (a low, retro frame rate). If your device asks for reduced motion, it draws one still frame instead. |

### How a scene is drawn

`sanctuary.js` paints everything that never moves **once**, onto a hidden canvas. Then, 12 times a second, it copies that picture and draws only the moving parts on top: the flickering flame and its sparks, the window glow, the fireflies and the bunny breathing. That's why it's cheap enough for a phone.

The garden adapts to the screen: `layOut()` works out where the ground, well, cottage and path go from the canvas size, so a tall phone gets taller trees and a wide monitor gets a wider garden.

### Tweaking it

- **Colors**: each scene file starts with a palette object `C`. Change a color there and it changes everywhere.
- **The bunny**: edit the `BUNNY` strings in `sanctuary.js`. `o` is outline, `w` fur, `s` shadow, `p` pink, `e` the closed eye, `t` the tail, and `.` is empty.
- **Where things are**: `layOut()` in `sanctuary.js`.
- **The form on the door**: it's normal HTML placed over the door with percentages (`.door-form` in `styles.css`). If you redraw the door, nudge those percentages.

### Accessibility

The forms are ordinary HTML forms with labels, so screen readers, password managers and keyboards work as before. Focused fields get a bright yellow outline. The garden canvas has an `aria-label` describing the picture, and the decorative wall behind the door is hidden from screen readers.

## What's missing (on purpose)

Only the login, sign-up and Sanctuary pages are pixel art so far. The message pages and the admin page still use the plain card style.
