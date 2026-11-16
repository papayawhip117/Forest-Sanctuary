// scripts/create-invite.js
// -----------------------------------------------------------------------------
// Make an invite link from the command line:
//
//     npm run invite
//
// Why do we need this? Sign-up needs an invite, and invites are made on the
// admin page, which needs an account. Chicken and egg! Whoever can run
// commands on the server is trusted anyway (they could open the database
// file directly), so this script is how the very first invite gets made.
// Use it, sign up, and your account becomes the admin, because it's first.
// -----------------------------------------------------------------------------

require('dotenv').config();

const { createInvite, INVITE_TTL_DAYS } = require('../invites');

// The server doesn't run here, so we can't ask a request for its address.
// In order, we use:
//   1. APP_URL, if you set it (say, for a custom domain)
//   2. RENDER_EXTERNAL_URL, which Render sets by itself to the site's
//      https://<name>.onrender.com address
//   3. the local dev server
const baseUrl =
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${process.env.PORT || 3000}`;

const code = createInvite();

console.log(`New invite link (valid for ${INVITE_TTL_DAYS} days, works once):\n`);
console.log(`  ${baseUrl}/signup?code=${code}\n`);
console.log('Only a hash of the code is saved, so copy the link now.');
