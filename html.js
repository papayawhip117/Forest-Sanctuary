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

module.exports = { layout, page, escapeHtml };
