// server.js
// -----------------------------------------------------------------------------
// The entry point. Run it with `npm start` (or `npm run dev` to auto-restart
// whenever you save a file).
//
// The job of this file is just to wire things together:
//   1. load settings from .env
//   2. create the Express app
//   3. plug in "middleware" (functions that run on every request)
//   4. plug in our routes
//   5. start listening for requests
// -----------------------------------------------------------------------------

// 1. Load .env into process.env. This must happen BEFORE we require any file
//    that reads process.env (like db.js), so it goes first.
require('dotenv').config();

const path = require('node:path');
const express = require('express');
const authRoutes = require('./routes/auth');

// 2. Create the app. `app` is the object we attach everything else to.
const app = express();

// 3. Middleware.
//
// When a browser submits an HTML <form>, the fields arrive in the request body
// encoded like `username=cody&password=hunter2`. This middleware parses that
// into a normal object, available as `req.body` in our routes.
app.use(express.urlencoded({ extended: false }));

// Serve every file in /public as-is. So public/login.html is reachable at
// http://localhost:3000/login.html and public/styles.css at /styles.css.
// Visiting "/" serves public/index.html automatically.
app.use(express.static(path.join(__dirname, 'public')));

// 4. Routes. All the sign-up and login logic lives in routes/auth.js.
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
