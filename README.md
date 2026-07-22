# Swap, Share, Sustain ♻️

A student-run swap shop for the school community. Students exchange reusable
items — textbooks, stationery, uniforms, sports gear — instead of throwing them
away or buying new ones. Inspired by eBay, rebuilt for the school hallway.

**Save money · waste less · look out for each other.**

## Features

- **Landing page** explaining the project, with live stats and the newest items
- **Sign up / log in with your email** — students, teachers and staff all
  welcome (older accounts can still log in with their school number)
- **Post an item** with a photo, category, condition and description
- **Browse the board** with search and category filters
- **Request a swap** — offer one of your own items in return (with a photo
  preview of what you're giving), or just ask
- **Accept / decline requests** from your profile, with side-by-side photos of
  the two items in every request
- **Private chat** per swap request, where the two students plan when and
  where at school to meet and exchange
- **Notifications** — a badge in the header counts waiting requests and unread
  chat messages
- **Admin panel** (`admin.html`, admin accounts only) — review reported items,
  remove any post, ban/unban students, and manage the word filter
- **Troll protection** — a blocked-words filter (English + Thai) enforced by
  the database itself, a 🚩 report button on every item, and a ban system
  that mutes bad accounts
- **Profile pictures** — upload from your profile; shown in the header, on
  items, in chats and requests
- **The sticker wall** — a shared notebook-paper board on the landing page
  where every student places up to 5 emoji stickers for the whole school
  to see (refreshes live while many students decorate at once)
- **Wishlist** — post what you're *looking for*; anyone who has it can jump
  straight to posting it
- **Swap ratings** — after an accepted swap, both sides confirm it happened
  and rate each other (👍😐👎); a student's reputation shows on their items
- **Badges** — earned automatically: First swap 🌱, Eco hero ♻️, Generous
  giver 📦, Well loved 💚, Decorator ✨, Early bee 🐝
- **Dark mode** — one click in the header, remembered per device

## Try it

Open `index.html` in any modern browser — no install or build step needed.

Demo account: school number `10001`, password `demo1234`
(or click **"Try the demo account"** on the login page).

## How it works under the hood

The site is a static front end backed by **Supabase** (a hosted Postgres
database with authentication and file storage):

- **Accounts** use Supabase Auth with email + password. Accounts created
  before email login map school numbers to synthetic emails behind the
  scenes, and both kinds can log in from the same box. Passwords are properly
  hashed by the auth service. Emails live in a private `contacts` table that
  only the owner, an admin, or an accepted swap partner can read.
- **Items and swap requests** live in Postgres tables protected by Row Level
  Security: anyone can browse, but only owners can edit or delete their items,
  and only the two students involved can see a swap request.
- **Photos** are resized in the browser, then uploaded to a public Supabase
  storage bucket.
- **Accepting a swap** runs as a database function so both items are marked
  swapped atomically, and competing requests are auto-declined.

The full database setup (tables, security policies, functions) is in
[`supabase/setup.sql`](supabase/setup.sql) — paste it into the Supabase SQL
Editor to recreate the backend on a fresh project. Project credentials live in
[`js/config.js`](js/config.js); the anon key is safe to publish because all
access is controlled by the security policies.

## Project structure

```
index.html         Landing page
login.html         Log in / create account
browse.html        Item board with search & filters
wishes.html        Wishlist — "looking for" posts
upload.html        Post an item
item.html          Item details & swap requests
chat.html          Private chat for a swap request
profile.html       Your items, incoming & sent requests
admin.html         Moderation panel (admin accounts only)
css/style.css      Stylesheet (school-notebook theme)
js/config.js       Supabase project URL + anon key
js/store.js        Data layer (Supabase backend)
js/app.js          Shared UI helpers
supabase/setup.sql Database schema, security policies & functions
```

## Deploying

The site is fully static, so it can be hosted on **GitHub Pages**:
repo → Settings → Pages → deploy from the `main` branch, root folder.
