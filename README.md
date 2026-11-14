# Markdone References

Markdone is a private, account-backed library for YouTube, Instagram, TikTok, X, and Pinterest references. Save a link once and file it in any number of project folders.

## AI video analysis

Apply the Supabase migrations, then set `GOOGLE_GENERATIVE_AI_API_KEY` on the server to enable Gemini 3.5 Flash-Lite. Use a paid Gemini API project for production. Set `YOUTUBE_DATA_API_KEY` as well to use YouTube descriptions and to verify whether a public video is short enough (60 seconds or less) for direct analysis when its public text is sparse. Keep both keys out of browser code. Without the Gemini key, the library still saves and plays references.

New videos are analyzed when saved. Older videos can be analyzed from their preview on request. The title and AI notes are stored in Supabase, and auto-filing uses the same saved folders as manual filing. AI tries an existing folder first, creates one topic folder if needed, and respects manually selected folders. Opening a preview or refreshing the library never calls the model. The public demo does not use paid AI.

Most requests use public post details and, when useful, a single thumbnail. Markdone labels results based on this limited context. Public links that supply too little information may have no AI notes. No complete video or transcript is stored.

## Run locally

1. Run `npm ci` with Node.js 22 or newer.
2. Copy `.env.example` to `.env.local` and set the project URL and publishable key from a Supabase project dedicated to Markdone.
3. In Supabase Auth settings, enable the email provider and turn off **Allow new users to sign up**. Apply the SQL files in `supabase/migrations` in filename order using the SQL editor or a linked Supabase CLI project.
4. Set `SUPABASE_SECRET_KEY` and `MARKDONE_OWNER_EMAIL` in your local provisioning environment. Optionally set `MARKDONE_DEMO_EMAIL` to override `judges@markdone.example`. Run `npm run provision`. It creates two confirmed accounts, generates separate passwords, and seeds only the judges’ library. It writes credentials to the gitignored `.env.markdone-accounts.json` with owner-only file permissions. Keep this file for safe retries. On an existing demo account, running the command again restores missing sample folders or cards.
5. Run `npm run dev` and visit [http://localhost:3000](http://localhost:3000).

## Publish to Vercel

Deploy the project as Next.js using Vercel’s project import or `vercel deploy --prod`. Set only the two variables from `.env.example` in the Vercel project. Keep the Supabase secret key in your local provisioning environment. Ensure the production URL is reachable without Vercel Authentication, then open `/sign-in` there in a signed-out browser. Share the production URL and only the demo account’s credentials with judges.

## Verify

Run `npm test` and `npm run build`. On the deployed URL, sign in as each account from separate browser sessions. Check that each account sees its own folders and references, and that the demo opens with five seed cards. Open each player and confirm the **Open original** link works when playback is blocked. Save a second URL format for an existing item, assign it to both folders, delete one folder, and check that the item stays in All References. Reload the same account from a second device to verify persistence.

## Edit the Try demo catalog

Open `public.demo_references` in the Supabase Table Editor to add or remove sample links. Enter a supported post URL, an optional title, a sort order, and any sample folders using the keys `motion` and `visual`. For Pinterest, use the full Pin URL. Reloading Try demo picks up new samples. Judge edits stay in their own browser.
