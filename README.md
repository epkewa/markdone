# Markdone References

Markdone is a private, account-backed library for YouTube, Instagram, TikTok, and X references. Save a link once and file it in any number of project folders.

## Run locally

1. Run `npm ci` with Node.js 22 or newer.
2. Copy `.env.example` to `.env.local` and set the project URL and publishable key from a Supabase project dedicated to Markdone.
3. In Supabase Auth settings, enable the email provider and turn off **Allow new users to sign up**. Apply the SQL in `supabase/migrations/20261114000000_reference_library.sql` using the SQL editor or a linked Supabase CLI project.
4. Set `SUPABASE_SECRET_KEY` and `MARKDONE_OWNER_EMAIL` in your local provisioning environment. Optionally set `MARKDONE_DEMO_EMAIL` to override `judges@markdone.example`. Run `npm run provision`. It creates two confirmed accounts, generates separate passwords, and seeds only the judges’ library. It writes credentials to the gitignored `.env.markdone-accounts.json` with owner-only file permissions. Keep this file for safe retries. On an existing demo account, running the command again restores missing sample folders or cards.
5. Run `npm run dev` and visit [http://localhost:3000](http://localhost:3000).

## Publish to Vercel

Deploy the project as Next.js using Vercel’s project import or `vercel deploy --prod`. Set only the two variables from `.env.example` in the Vercel project. Keep the Supabase secret key in your local provisioning environment. Ensure the production URL is reachable without Vercel Authentication, then open `/sign-in` there in a signed-out browser. Share the production URL and only the demo account’s credentials with judges.

## Verify

Run `npm test` and `npm run build`. On the deployed URL, sign in as each account from separate browser sessions. Check that each account sees its own folders and references, and that the demo opens with four seed cards. Open each player and confirm the **Open original** link works when playback is blocked. Save a second URL format for an existing item, assign it to both folders, delete one folder, and check that the item stays in All References. Reload the same account from a second device to verify persistence.
