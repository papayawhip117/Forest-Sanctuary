# Forest-Sanctuary
Aesthetic forest themed login page+project for learning authentication, database usage, cookies and deployment. 

## Roadmap

1. **Sign-up and login with hashed passwords** ← you are here
2. Sessions and cookies, so the server remembers who is logged in
3. Invite codes, so only invited people can sign up
4. Deployment, so it runs on the internet
5. The forest look and feel

## Running it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install            # download the libraries listed in package.json
cp .env.example .env   # create your own settings file
npm run dev            # start the server; restarts when you save a file
```

Then open http://localhost:3000, make an account, and log in.

To look inside the database while you learn, the [SQLite CLI](https://sqlite.org/cli.html) works well:

```bash
sqlite3 data/forest.db "SELECT * FROM users;"
```

You will see each password stored as a long `$2b$12$...` string, never the real password. To start over, stop the server and delete the `data/` folder.

## How the pieces fit together

```
Browser                         Server (Node + Express)                 Disk
───────                         ───────────────────────                 ────
public/signup.html  ──POST /signup──▶  routes/auth.js
                                        ├─ validate input
                                        ├─ bcrypt.hash(password)
                                        └─ db.createUser() ──────────▶  data/forest.db
public/login.html   ──POST /login───▶  routes/auth.js
                                        ├─ db.findUserByUsername() ◀──  data/forest.db
                                        └─ bcrypt.compare(password, hash)
```

### The files

| File | What it does |
| --- | --- |
| `server.js` | Starting point. Loads `.env`, creates the Express app, plugs in middleware and routes, and starts listening. |
| `db.js` | Opens the SQLite database, creates the `users` table, and exposes `createUser` and `findUserByUsername`. |
| `routes/auth.js` | The `POST /signup` and `POST /login` handlers. All the password logic is here. |
| `public/` | Plain HTML and CSS sent straight to the browser: the home page and the two forms. |
| `.env.example` | The settings the app expects. Copy it to `.env` (which git ignores). |

### Express

[Express](https://expressjs.com) is a small web framework. You write *routes* like `router.post('/login', handler)`, meaning "when a POST request arrives for `/login`, run this function". The handler gets `req` (the incoming request) and `res` (what you send back).

*Middleware* are functions that run on every request before your routes. We use two:

- `express.urlencoded()` reads submitted form fields into `req.body`.
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

Settings that differ between your laptop and a real server (and later, secrets like a session key) go in `.env`. The `dotenv` library loads it into `process.env` when the server starts. `.env` is in `.gitignore` so it never gets committed. `.env.example` is committed so others can see which settings exist.

## What's missing (on purpose)

Logging in currently just checks your password and says hello. The server forgets you on the very next page. Remembering a logged-in user takes **sessions and cookies**, which is step 2.
