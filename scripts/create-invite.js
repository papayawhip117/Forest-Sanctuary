// scripts/create-invite.js
// -----------------------------------------------------------------------------
// Make an invite link from the command line:
//
//     npm run invite          (for your local database)
//     npm run invite:prod     (for the deployed site's Turso database)
//
// Why do we need this? Sign-up needs an invite, and invites are made on the
// admin page, which needs an account. Chicken and egg! Whoever holds the
// database credentials is trusted anyway (they could edit the tables
// directly), so this script is how the very first invite gets made.
// Use it, sign up, and your account becomes the admin, because it's first.
//
// `invite:prod` runs this same file with `node --env-file=.env.production`,
// which loads your production settings (DATABASE_URL, DATABASE_AUTH_TOKEN and
// APP_URL) before the script starts. dotenv then loads .env too, but it never
// overwrites a value that is already set, so the production ones win. The
// script runs on YOUR laptop but writes to the Turso database the deployed
// site uses, so the invite works there.
// -----------------------------------------------------------------------------

require('dotenv').config();

const { db, initDatabase } = require('../db');
const { createInvite, INVITE_TTL_DAYS } = require('../invites');

// The server doesn't run here, so we can't ask a request for its address.
// Use APP_URL if it's set (in .env.production, your onrender.com address),
// otherwise assume the local dev server.
const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

async function main() {
  // Make sure the tables exist (on a brand-new Turso database they won't yet).
  await initDatabase();
  const code = await createInvite();

  console.log(`New invite link (valid for ${INVITE_TTL_DAYS} days, works once):\n`);
  console.log(`  ${baseUrl}/signup?code=${code}\n`);
  console.log('Only a hash of the code is saved, so copy the link now.');
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
