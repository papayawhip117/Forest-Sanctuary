// html.js
// -----------------------------------------------------------------------------
// Little helpers for building HTML pages in our routes. Both routes/auth.js
// and routes/admin.js use them, so they live in their own file. A later step
// could swap these for a real template engine.
// -----------------------------------------------------------------------------

// The shared outer shell of every page. `body` is HTML that goes inside the
// card. `wide` gives the card more room (used by the admin table).
function layout(title, body, { wide = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Forest Sanctuary</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="card${wide ? ' wide' : ''}">
    <h1>${title}</h1>
${body}
  </main>
</body>
</html>`;
}

// The <head> bits the pixel-art pages share: the pixel font from Google
// Fonts (falls back to a normal font if it can't load) and our stylesheet.
const sceneHead = (title) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Forest Sanctuary</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600&display=swap">
  <link rel="stylesheet" href="/styles.css">
</head>`;

// A page where `body` sits ON the overgrown wooden door. Same markup as
// public/login.html (the sign-up form uses this, so it matches the login).
// public/art/door.js paints the door and the wall behind it.
function doorLayout(title, body) {
  return `${sceneHead(title)}
<body class="scene-page">
  <canvas id="wall-art" class="backdrop" aria-hidden="true"></canvas>
  <main class="door">
    <canvas id="door-art" role="img"
            aria-label="An old wooden door in a stone arch, overgrown with vines and moss"></canvas>
    <div class="door-form">
      <h1>Forest Sanctuary</h1>
${body}
    </div>
  </main>
  <script type="module" src="/art/door.js"></script>
</body>
</html>`;
}

// A full-screen pixel-art scene with a small panel of text on top.
// `script` paints the canvas; `description` tells screen-reader users what
// the picture shows, since they can't see it.
function sceneLayout(title, body, { script, canvasId, description }) {
  return `${sceneHead(title)}
<body class="scene-page">
  <canvas id="${canvasId}" class="backdrop" role="img" aria-label="${description}"></canvas>
  <main class="scene-panel">
    <h1>${title}</h1>
${body}
  </main>
  <script type="module" src="${script}"></script>
</body>
</html>`;
}

// A tiny page showing a message with a link onward.
// `message` is put in as HTML, so escape anything a user typed before passing
// it in.
function page(title, message, linkHref, linkText = 'Go back') {
  return layout(
    title,
    `    <p>${message}</p>
    <p><a href="${escapeHtml(linkHref)}">${linkText}</a></p>`
  );
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

module.exports = { layout, doorLayout, sceneLayout, page, escapeHtml };
