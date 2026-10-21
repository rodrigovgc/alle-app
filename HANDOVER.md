# Alle — handover for a new chat

Read this first. It explains what Alle is, where everything lives, how work has
been done so far, what's finished and what's still open. Last updated: 8 October 2026.

---

## 1. What Alle is

A free flashcard web app by **Rodrigo** (senior product designer, Brussels). People
make decks from a two-column Google Sheet, with AI (Alle writes a prompt, the
person's own AI writes the cards), or from ready-made decks, and study with
spaced repetition (Leitner boxes). Brand name is **Alle** (never "Alle Cards").

| | Address | Repo | Vercel project |
|---|---|---|---|
| App | https://my.allecards.app | `rodrigovgc/alle-app` | Alle2 (label only; may be renamed alle-app) |
| Website | https://allecards.app (www redirects to it) | `rodrigovgc/alle-site` | alle-site |

Database and sign-in: **Supabase** (project "Alle"). Emails: Supabase Auth via
**Resend** SMTP from hello@allecards.app. Analytics on the website: Google
Analytics + Hotjar, both only after cookie consent.

The app repo was called `alle2` until 8 Oct 2026 (GitHub redirects the old name).

---

## 2. How to continue in a new chat

1. Rodrigo creates a **fine-grained GitHub token** (GitHub → Settings → Developer
   settings → Personal access tokens → Fine-grained tokens → Generate):
   repository access **only `alle-app` and `alle-site`**, permission
   **Contents: Read and write**, 30-day expiry. He pastes it in the chat.
   (Delete the previous "Claude Alle" token: it was shared in an old chat.)
2. Save it to a file without printing it, then clone both repos:
   ```bash
   umask 077; printf '%s' '<TOKEN>' > ~/.ghtoken
   mkdir -p ~/gh && cd ~/gh
   for r in alle-app alle-site; do git clone -q "https://x-access-token:$(cat ~/.ghtoken)@github.com/rodrigovgc/$r.git"; done
   git -C alle-app config user.name "Claude for Rodrigo"; git -C alle-app config user.email "rodrigovgc@users.noreply.github.com"
   git -C alle-site config user.name "Claude for Rodrigo"; git -C alle-site config user.email "rodrigovgc@users.noreply.github.com"
   ```
   Always pipe git output through `sed "s/$(cat ~/.ghtoken)/***/g"` so the token never appears.
3. Pushing to `main` deploys to production on Vercel automatically. After a push,
   check the deploy through the commit status API:
   `GET https://api.github.com/repos/rodrigovgc/<repo>/commits/<sha>/status` →
   `Vercel: success, "Deployment has completed"`.

---

## 3. How work has been done (keep doing it this way)

- **Change → test in a real browser → push → report what went live.** Rodrigo
  expects changes to be committed and pushed, not sent as zips.
- **Before every push, run `git status --short` and check the file list.**
  (Once `node_modules` got pushed to alle-site because it had no `.gitignore`;
  both repos have one now.)
- **Test like a user** with Playwright against a local build in demo mode:
  `echo "VITE_DEMO=true" > .env.local && npm install && npx vite build && npx vite preview --port 4xxx`.
  Demo mode (`src/lib/demoClient.js`) stores everything in localStorage, so tests
  sign up, seed decks/groups into `localStorage['alle-demo-db']`, reload, and act.
  Test phone (393×852, touch) **and** desktop. Measure things (positions, overflow,
  "is this menu item clickable via elementFromPoint") rather than eyeballing.
  `npm test` runs 13 logic tests.
- **Test SQL before giving it to Rodrigo**: install PostgreSQL in the sandbox,
  stub Supabase (`auth` schema with `users`, `auth.uid()` reading a setting,
  roles `anon`/`authenticated`), run `schema.sql` then 002…011 in order, then the
  new file twice (must be safe to re-run).
- **Rodrigo runs SQL himself** in Supabase → SQL Editor. Give him the SQL text in
  a code block (pasting a file *name* fails), and say what success looks like.
- **Database changes must not break the app before he runs them**: the app
  tolerates a missing column/table (falls back, or shows "needs one database
  update: run supabase/0xx.sql").
- **Communication**: plain, friendly language; Rodrigo is a designer, not a
  developer. Lead with what changed and what he needs to do. Exact click paths
  for anything outside the code (Vercel, Supabase, Google, Woorank). Own
  mistakes plainly. Ask before choices that change behaviour for users.
- **Design taste**: editorial, calm, iOS-like. Pastel deck colours, Inter font,
  frosted bars, no heavy borders. He reviews with screenshots; match them closely.

---

## 4. The app (`alle-app`)

React + Vite, framer-motion, @dnd-kit, Supabase JS. Key places:

- `src/App.jsx` — data loading, all actions (create/update/share decks and groups,
  study sessions, incoming share links), analytics events.
- `src/screens/Home.jsx` — home screen, sheets (popups), menus.
- `src/components/GroupedBoard.jsx` — groups with drag and drop (dnd-kit:
  MouseSensor 6px, TouchSensor long-press 350ms for group titles only).
- `src/components/Scenes.jsx` + `src/styles/scenes.css` — the tour's animated
  scenes. **One source for app and website**: the app build also publishes them
  as `/embed/scenes.json` + `/embed/scenes.css` (plugin in `vite.config.js`,
  CORS in `vercel.json`); the website's `public/scenes.js` loads them into any
  `<div data-alle-scene="welcome|ready|sheets|ai|study|home">` (Help page,
  homepage guides). Add `alle-scene--light` on light-only pages.
- `src/lib/saved.js` — `announceSaved()` shows the "✓ Changes saved" toast
  (App.jsx). Call it after any change that saves on its own.
- `src/components/AiBuilder.jsx` — Create with AI (5 steps: subject, topic/focus,
  sides as a sheet mockup, size, finish = copy prompt + paste reply).
- `src/components/Sheet.jsx` — popups/bottom sheets; frosted header; hairlines
  only when content is scrolled under (`is-scrolled`) or continues (`has-more`).
- `src/components/AutoInput.jsx` — a field as wide as its text with a pencil right after.
- `src/styles/tokens.css` — design tokens. Page background `#FBFAF6`, surface
  beige `#F6F4EC`, deeper beige `#E8E5DA`. Dark mode block sets its own `--page-bg`.
- `src/styles/tokens.js` — `pickDeckLook`: new decks follow the rainbow
  (yellow, green, blue, red, purple, lime, pink) after the last deck; **never beige**.
- `src/lib/sampleDeck.js` — ready-made decks (10): Basic French, Organic chemistry,
  Art history, Guitar chords, Engineering Formula Sheet, Numbers in Portuguese,
  Road signs (sheets) + Flags of the world, Multiplication tables, Telling time
  in Dutch (built in).
- `api/` (Vercel functions): `share.js` (preview page for `/s/<code>` decks and
  `/g/<code>` groups), `og.js` + `_cover.js` (1200×630 cover image with the real
  Alle logo, Inter fonts in `api/fonts`), `sheet-name.js`.
- `/dashboard` — owner-only insights (`dash_insights`, gated by `is_owner()` with
  Rodrigo's email, set in 005).

**Groups model**: every deck is always in a group; there is always at least one
group ("My study decks" is created automatically and orphan decks moved into it).
Group menu (settings icon) has the same items for every group: Shuffle this group,
Reorder decks, Repaint decks (this group only), New group (placed after), Share
group, Delete group (deletes its decks after confirming, or "keep the decks: move
to …"); items that don't apply are greyed out. Click a group name to rename (view
and edit share one box so nothing moves). Desktop: drag decks between groups,
drag group titles to reorder. The floating button is "+ Add new deck".

**Gotchas learned the hard way**
- A frosted layer that extends outside its box counts as content and makes popups
  scroll; keep pseudo-element backgrounds inside their element.
- Anything with changing `opacity` flattens 3D transforms (broke a card flip).
- framer-motion `transitionEnd` doesn't run for elements that mount without
  animating (`AnimatePresence initial={false}`); use onAnimationStart/Complete state.
- `.home__title` carries padding on all sides; inside rows, reset it.
- Inputs have an intrinsic ~20ch width; use `size={1}` plus a hidden sizer.
- Supabase Advisor lists `get_shared_deck_meta` / `get_shared_group_meta` as
  callable without sign-in: intended (link-preview bots), cover details only.

---

## 5. Database migrations (Supabase → SQL Editor, in order)

`schema.sql`, then `002`…`011`. Status as far as known:
- 002–010: run.
- **011_share_groups.sql: Rodrigo was asked to run it on 8 Oct** (sharing a group
  showed "needs one database update"). Confirm it's done.

---

## 6. The website (`alle-site`)

Static HTML built by Vite (the repo also contains an unused copy of app code:
`src/`, `supabase/`, app `package.json` — the build depends on that package.json,
so clean it up only carefully, in its own commit).

- `index.html` — homepage. FAQ (7 questions) is static HTML (`details`/`summary`
  with `h3`), readable without JavaScript. The deck-library cards, logo and
  sign-in links are written into the HTML too (the script rebuilds them identically).
- JSON-LD `@graph`: Organization + WebSite (alternateName `allecards.app`) +
  WebApplication — only properties stated on the page. **No FAQ schema.**
- Title: "Alle | Flashcard App for What You Need to Learn".
- `public/help.html` (animated scenes from the app's tour, `help-scenes.css`),
  `privacy.html`, `terms.html`, `template.html` (Google Sheet template page; the
  sheet URL is in its "Make a copy" button), `404.html` (generated from homepage
  pieces), `robots.txt`, `sitemap.xml`.
- `vercel.json`: clean URLs (`/help`, `/privacy`, `/terms`, `/template`), no catch-all.
- Canonical domain: **https://allecards.app** everywhere (Vercel: apex is
  production, www redirects to it).
- robots.txt: search/answer crawlers allowed (Googlebot, Bingbot, OAI-SearchBot,
  ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User);
  training-only crawlers disallowed (GPTBot, ClaudeBot, CCBot, Applebot-Extended);
  Google-Extended allowed (also controls Gemini grounding).

---

## 7. Open items

- Confirm 011 has been run (group sharing).
- Final Google Sheet template URL from Rodrigo → update `public/template.html`.
- Google Search Console: resubmit `https://allecards.app/sitemap.xml`, request
  indexing; add Bing Webmaster Tools (import from GSC).
- Vercel → Firewall → Bot Management: make sure "AI Bots" isn't blocking.
- Possibly bring back a "shuffle decks across groups" option (asked; not decided).
- Ideas discussed, not started: website data (GA4 + Search Console via a Google
  service account) in `/dashboard`; generating AI decks inside Alle (server-side,
  costs money, needs a per-account daily limit); `sameAs` links once real
  profiles exist (Product Hunt, LinkedIn, AlternativeTo); DMARC to `p=reject`
  after a few calm weeks; Google sign-in.
- Rodrigo's decision pending: whether to keep blocking AI *training* crawlers.

---

## 8. Older history

Earlier work (design system, study modes, fix-up round, onboarding tour, emails,
security fixes, sharing, dashboard) is summarised in the commit history:
`git log --oneline` in each repo has descriptive messages.

## Alle's own AI (test branch: test/home-tabs)
- The AI builder's last step makes the cards in the app: `api/generate-deck.js` (Vercel function) → Claude, with an editable preview before Add deck. "Use your own AI instead" keeps the copy-the-prompt flow.
- Only signed-in people; `AI_MONTHLY_FREE` decks a month each (default 3), counted in `ai_generations` (run `supabase/012_ai_decks.sql`).
- Env vars (Vercel): `ANTHROPIC_API_KEY` (required to switch it on), optional `AI_MODEL` (default `claude-haiku-5-5`), `AI_MONTHLY_FREE`, `AI_UNLIMITED_EMAILS` (comma list, e.g. the owner).
- Without a key: test builds return pretend cards; the live app says AI isn't switched on yet. Demo mode makes pretend cards in the browser (`src/lib/aiDeck.js`).
- Before going live: add a paragraph to the website's privacy page (builder choices are sent to Anthropic to write the cards) and set a monthly spend limit in the Anthropic Console.


## New database tables (from 30 Oct 2026)

Supabase no longer gives new tables in `public` API access automatically. Every
migration that creates a table must also grant it, next to `enable row level
security`, for example:

```sql
grant select, insert, update, delete on public.my_table to authenticated;
grant all on public.my_table to service_role;
```

Only grant `anon` when signed-out visitors really need the table. Without a
grant the app gets "permission denied". `supabase/016_explicit_grants.sql` lists
the access every current table needs.
