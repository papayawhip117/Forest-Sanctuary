// routes/admin.js
// -----------------------------------------------------------------------------
// The admin's invite page: /admin/invites
//
// Only admins (users with is_admin = 1, which is the first account) can see
// it. From here you can make new invite links and see which ones were used.
// -----------------------------------------------------------------------------

const express = require('express');
const { findUserById } = require('../db');
const { createInvite, listInvites, INVITE_TTL_DAYS } = require('../invites');
const { requireLogin } = require('./auth');
const { layout, escapeHtml } = require('../html');

const router = express.Router();

// -----------------------------------------------------------------------------
// requireAdmin: like requireLogin (in routes/auth.js), but stricter.
// -----------------------------------------------------------------------------
// It runs AFTER requireLogin, so we already know someone is logged in. Now we
// check the database to see if they are an admin.
//
// Note the difference between the two answers:
//   401 / redirect to login  = "we don't know who you are"   (authentication)
//   403 Forbidden            = "we know who you are, and no" (authorization)
function requireAdmin(req, res, next) {
  const user = findUserById(req.session.userId);
  if (user && user.is_admin) {
    return next();
  }
  res.status(403).send(
    layout('Not allowed', '    <p>Only admins can make invites.</p>\n    <p><a href="/sanctuary">Back to the Sanctuary</a></p>')
  );
}

// `router.use` applies these two guards to every route in this file, in order.
router.use('/admin', requireLogin, requireAdmin);

// -----------------------------------------------------------------------------
// POST /admin/invites  (the "Create invite link" button)
// -----------------------------------------------------------------------------
router.post('/admin/invites', (req, res) => {
  const code = createInvite(req.session.userId);

  // Build the full link someone can click. req.protocol is "http" or "https",
  // and req.get('host') is whatever is in the address bar, like
  // "localhost:3000", so the link works wherever the site is running.
  const link = `${req.protocol}://${req.get('host')}/signup?code=${code}`;

  // The "Post/Redirect/Get" pattern: instead of showing the link in this
  // response, redirect to the GET page. Otherwise refreshing the page would
  // re-submit the form and quietly create another invite.
  //
  // But then how does the GET page know the new link? We park it in the
  // session for one request. This is called a "flash" message: the next page
  // shows it once and deletes it.
  req.session.newInviteLink = link;
  res.redirect('/admin/invites');
});

// -----------------------------------------------------------------------------
// GET /admin/invites  (the page itself)
// -----------------------------------------------------------------------------
router.get('/admin/invites', (req, res) => {
  // Read the flash message, then remove it so it only shows once.
  const newLink = req.session.newInviteLink;
  delete req.session.newInviteLink;

  // The new link, if one was just made. It's shown in a read-only text box so
  // it's easy to select and copy.
  const newLinkHtml = newLink
    ? `    <div class="notice">
      <p><strong>New invite link.</strong> Copy it now: it won't be shown again,
         because only a hash of the code is stored.</p>
      <input class="copy" readonly value="${escapeHtml(newLink)}" aria-label="New invite link" onfocus="this.select()">
    </div>
`
    : '';

  const rows = listInvites()
    .map((invite) => {
      let status;
      if (invite.used_by_name) {
        status = `Used by ${escapeHtml(invite.used_by_name)}`;
      } else if (invite.expired) {
        status = 'Expired';
      } else {
        status = 'Waiting';
      }
      // SQLite times are UTC; the " UTC" label keeps that honest.
      return `        <tr><td>#${invite.id}</td><td>${invite.created_at} UTC</td><td>${invite.expires_at} UTC</td><td>${status}</td></tr>`;
    })
    .join('\n');

  const tableHtml = rows
    ? `    <div class="table-wrap"><table>
      <thead><tr><th>Invite</th><th>Created</th><th>Expires</th><th>Status</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>`
    : '    <p>No invites yet.</p>';

  res.send(
    layout(
      'Invites',
      `${newLinkHtml}    <p>Each link lets one person create one account, within ${INVITE_TTL_DAYS} days.</p>
    <form method="post" action="/admin/invites">
      <button type="submit">Create invite link</button>
    </form>
${tableHtml}
    <p><a href="/sanctuary">Back to the Sanctuary</a></p>`,
      { wide: true }
    )
  );
});

module.exports = router;
